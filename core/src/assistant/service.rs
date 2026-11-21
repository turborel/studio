//! The assistant's conversations (RULES.md D55): each on a connection of
//! the assistant's own, opened as it first asks, its schema's context read
//! then; each turn run on a thread named for its conversation, telling the
//! window through the backend's events and waiting for the user's answers
//! to its questions, which the window gives by their numbers. A question
//! not answered within its time is taken as no.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use crate::assistant::audit::Audit;
use crate::assistant::context::schema_context;
use crate::assistant::policy::{Level, Policies};
use crate::assistant::settings::Assistant;
use crate::assistant::toolbox::{SessionTools, open_session};
use crate::assistant::turn::{Conversation, Host, Parts, Prompt, Question, TurnEvent, failed, run_turn};
use crate::catalog::Catalog;
use crate::connections::manager::ConnectionManager;
use crate::error::{Result, StudioError};
use crate::events::{ConnectionId, Event, EventSink};
use crate::saved::SavedConnections;
use crate::secret::Secret;
use crate::secrets::SecretStore;

/// The longest a question waits for its answer.
const ANSWER_WITHIN: Duration = Duration::from_mins(30);
/// The most tables of a schema whose context is read whole.
const CONTEXT_TABLES: usize = 200;

/// The keychain's key of the password of a saved connection's assistant login.
fn login_key(saved: &str) -> String {
    format!("assistant-login:{saved}")
}

/// A conversation, and the assistant's connection it runs on.
struct Talk {
    conversation: Conversation,
    name: String,
    connection: ConnectionId,
    schema: Option<String>,
}

/// The questions waiting for their answers, by their numbers.
type Pending = Arc<Mutex<HashMap<u64, Sender<bool>>>>;

/// The window of a conversation, as its turn sees it: told by the events,
/// its questions waiting for their answers.
struct Window {
    conversation: String,
    events: Arc<dyn EventSink>,
    pending: Pending,
    next: Arc<AtomicU64>,
}

impl Host for Window {
    fn tell(&self, event: TurnEvent) {
        self.events.emit(Event::Assistant { conversation: self.conversation.clone(), event });
    }

    fn ask(&self, question: Question) -> bool {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (answer, answered) = channel();
        self.pending.lock().unwrap_or_else(PoisonError::into_inner).insert(id, answer);
        self.events.emit(Event::AssistantAsks { conversation: self.conversation.clone(), id, question });
        let yes = answered.recv_timeout(ANSWER_WITHIN).unwrap_or(false);
        self.pending.lock().unwrap_or_else(PoisonError::into_inner).remove(&id);
        yes
    }
}

/// What a conversation is asked on: the saved connection, and its
/// session's schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asked {
    /// The saved connection's identifier.
    pub saved: String,
    /// Its session's schema.
    pub schema: Option<String>,
}

/// The assistant's conversations.
pub struct Service {
    /// The settings and keys.
    pub assistant: Assistant,
    /// The policies.
    pub policies: Policies,
    /// The log.
    pub audit: Audit,
    saved: Arc<SavedConnections>,
    secrets: Arc<dyn SecretStore>,
    manager: Arc<ConnectionManager>,
    events: Arc<dyn EventSink>,
    talks: Mutex<HashMap<String, Arc<Mutex<Talk>>>>,
    pending: Pending,
    next: Arc<AtomicU64>,
}

impl Service {
    /// The conversations of `dir`'s files, `saved`'s connections opened by
    /// `manager`, keys in `secrets`, the window told by `events`.
    pub fn new(
        dir: &std::path::Path,
        (saved, secrets): (Arc<SavedConnections>, Arc<dyn SecretStore>),
        manager: Arc<ConnectionManager>,
        events: Arc<dyn EventSink>,
    ) -> Service {
        Service {
            assistant: Assistant::new(dir, Arc::clone(&secrets)),
            policies: Policies::new(dir),
            audit: Audit::new(dir),
            saved,
            secrets,
            manager,
            events,
            talks: Mutex::new(HashMap::new()),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next: Arc::new(AtomicU64::new(1)),
        }
    }

    /// Keeps `password` as the assistant login's of saved connection `saved`, or forgets it of none.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the keychain refuses it.
    pub fn set_login_password(&self, saved: &str, password: Option<&Secret>) -> Result<()> {
        match password {
            Some(p) if !p.expose().is_empty() => self.secrets.set(&login_key(saved), p),
            _ => self.secrets.delete(&login_key(saved)),
        }
    }

    /// Answers question `id`: whether the user agrees.
    pub fn answer(&self, id: u64, yes: bool) {
        if let Some(answer) = self.pending.lock().unwrap_or_else(PoisonError::into_inner).remove(&id) {
            let _ = answer.send(yes); // A turn that ended waits no more.
        }
    }

    /// Forgets conversation `id`, its connection closed.
    pub fn forget(&self, id: &str) {
        let talk = self.talks.lock().unwrap_or_else(PoisonError::into_inner).remove(id);
        if let Some(talk) = talk {
            let connection = talk.lock().unwrap_or_else(PoisonError::into_inner).connection;
            let _ = self.manager.close(connection); // One already closed needs no closing.
        }
    }

    /// The talk of conversation `id`, begun on `asked` if it is new: its
    /// connection opened and its schema's context read.
    fn talk(&self, id: &str, asked: &Asked) -> Result<Arc<Mutex<Talk>>> {
        if let Some(talk) = self.talks.lock().unwrap_or_else(PoisonError::into_inner).get(id) {
            return Ok(Arc::clone(talk));
        }
        let saved = self
            .saved
            .list()?
            .connections
            .into_iter()
            .map(|v| v.connection)
            .find(|c| c.id == asked.saved)
            .ok_or_else(|| StudioError::misuse("[DESIGN] the assistant works on a saved connection: save it first"))?;
        let policy = self.policies.of(Some(&saved.id), saved.environment)?;
        let settings = self.assistant.settings()?;
        let password = self.saved.password(&saved.id)?;
        let login_password = policy.login.as_ref().map(|_| self.secrets.get(&login_key(&saved.id))).transpose()?.flatten();
        let login = policy.login.as_deref().map(|user| (user, login_password.as_ref()));
        let opened = open_session(&self.manager, &saved, (password.as_ref(), login), &policy)?;
        let schema = asked.schema.clone().or_else(|| opened.session.schema.clone());
        let context = self.context(opened.connection, schema.as_deref(), &policy.hidden).unwrap_or_default();
        let conversation = Conversation { wire: self.assistant.endpoint(&settings).map(|e| e.wire)?, messages: Vec::new(), context };
        let talk = Arc::new(Mutex::new(Talk { conversation, name: saved.name, connection: opened.connection, schema }));
        self.talks.lock().unwrap_or_else(PoisonError::into_inner).insert(id.to_owned(), Arc::clone(&talk));
        Ok(talk)
    }

    /// The context of `schema` on `connection`, its tables but those `hidden` says.
    fn context(&self, connection: ConnectionId, schema: Option<&str>, hidden: &[String]) -> Result<String> {
        let Some(schema) = schema else { return Ok("No schema is the session's.".to_owned()) };
        let catalog = Catalog::of(&self.manager, connection);
        let objects = catalog.objects(schema)?;
        let tables: Vec<_> = objects.tables.iter().take(CONTEXT_TABLES).filter_map(|t| catalog.table(schema, &t.name).ok()).collect();
        let hide = |s: &str, t: &str| hidden.iter().any(|h| h.eq_ignore_ascii_case(s) || h.eq_ignore_ascii_case(&format!("{s}.{t}")));
        Ok(schema_context(schema, &tables, hide))
    }

    /// Asks conversation `id`, on `asked`, of `prompt`: its turn run on a
    /// thread of its own, the window told as it goes.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of an assistant off, of a connection whose policy is
    /// Off, of no key, or of a thread that cannot start; the connection's
    /// failure as its connection opens.
    pub fn ask(self: &Arc<Service>, id: &str, asked: &Asked, prompt: Prompt) -> Result<()> {
        if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err(StudioError::misuse("[DESIGN] a conversation's identifier is 1 to 64 letters, digits or hyphens"));
        }
        let settings = self.assistant.settings()?;
        if !settings.enabled {
            return Err(StudioError::misuse("[DESIGN] the assistant is off: turn it on in its settings"));
        }
        let saved = self.saved.list()?.connections.into_iter().map(|v| v.connection).find(|c| c.id == asked.saved);
        let environment = saved.map(|s| s.environment).unwrap_or_default();
        let policy = self.policies.of(Some(&asked.saved), environment)?;
        if policy.level_on(environment) == Level::Off {
            return Err(StudioError::misuse("[DESIGN] the assistant is off on this connection: its policy says so"));
        }
        let endpoint = self.assistant.endpoint(&settings)?;
        let talk = self.talk(id, asked)?;
        let service = Arc::clone(self);
        let conversation = id.to_owned();
        let work = move || {
            let window = Window {
                conversation,
                events: Arc::clone(&service.events),
                pending: Arc::clone(&service.pending),
                next: Arc::clone(&service.next),
            };
            let mut talk = talk.lock().unwrap_or_else(PoisonError::into_inner);
            let tools = SessionTools {
                manager: &service.manager,
                connection: talk.connection,
                policy: &policy,
                environment,
                schema: talk.schema.clone(),
            };
            let name = talk.name.clone();
            let parts = Parts { endpoint: &endpoint, settings: &settings, policy: &policy, connection: &name, audit: &service.audit };
            if let Err(e) = run_turn(&mut talk.conversation, &prompt, &parts, (&tools, &window)) {
                window.tell(failed(&e));
            }
        };
        std::thread::Builder::new()
            .name(format!("studio-assistant-{id}"))
            .spawn(work)
            .map(|_| ())
            .map_err(|e| StudioError::misuse(format!("[DESIGN] the assistant's thread cannot start: {e}")))
    }
}
