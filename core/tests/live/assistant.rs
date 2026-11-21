//! The live tests of the assistant (RULES.md D55): its tools on a
//! connection of its own, READ ONLY, against the server, and a turn of the
//! tests' own model server calling them; no real model is asked.

use std::cell::RefCell;

use serde_json::{Map, Value, json};
use turborel_studio_core::assistant::http::Endpoint;
use turborel_studio_core::assistant::mock::{Answer, MockModel, anthropic_stream};
use turborel_studio_core::assistant::policy::{ConnectionPolicy, Level};
use turborel_studio_core::assistant::settings::AssistantSettings;
use turborel_studio_core::assistant::toolbox::{SessionTools, open_session};
use turborel_studio_core::assistant::turn::{Conversation, Host, Parts, Prompt, Question, Toolbox, TurnEvent, run_turn};
use turborel_studio_core::assistant::wire::Wire;
use turborel_studio_core::saved::{Environment, SavedConnection};
use turborel_studio_core::secret::Secret;

use crate::{Live, run};

/// A window that approves what `yes` says, keeping what it was told.
struct Window {
    yes: bool,
    told: RefCell<Vec<TurnEvent>>,
}

impl Host for Window {
    fn tell(&self, event: TurnEvent) {
        self.told.borrow_mut().push(event);
    }
    fn ask(&self, _question: Question) -> bool {
        self.yes
    }
}

/// The input of `pairs`.
fn input(pairs: &[(&str, &str)]) -> Map<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), json!(v))).collect()
}

/// The saved connection of the owner, of `environment`.
fn saved(live: &Live) -> SavedConnection {
    SavedConnection {
        id: "assistant".into(),
        name: "live".into(),
        folder: Vec::new(),
        spec: live.spec(),
        environment: Environment::Development,
        colour: None,
        read_only: false,
        pinned: false,
        favourites: Vec::new(),
        embedded: None,
    }
}

/// The catalog's tools of `tools`: a hidden table left out and refused.
fn catalog_tools(tools: &SessionTools<'_>, yes: &Window) {
    let call = |name: &str, pairs: &[(&str, &str)]| tools.call(name, &input(pairs), yes);
    let schemas = call("list_schemas", &[]);
    assert!(schemas.content.contains("\"ANN\""), "{}", schemas.content);
    let tables = call("list_tables", &[("schema", "ANN")]).content;
    assert!(tables.contains("AS_STAFF") && !tables.contains("AS_SECRETS"), "{tables}");
    assert!(call("describe_table", &[("schema", "ANN"), ("table", "AS_STAFF")]).content.contains("CHARACTER VARYING"));
    assert_eq!(call("describe_table", &[("schema", "ANN"), ("table", "AS_SECRETS")]).outcome, "blocked: HIDDEN");
    assert!(call("explain", &[("sql", "SELECT NAME FROM ANN.AS_STAFF")]).content.contains("-- physical:"));
    // EXPLAIN ANALYZE runs its statement: the tool runs plain EXPLAIN alone.
    let analyzed = call("explain", &[("sql", "ANALYZE DELETE FROM ANN.AS_STAFF WHERE ID = 1")]);
    assert_eq!(analyzed.outcome, "blocked: EXPLAIN-ONLY");
    assert!(call("run_query", &[("sql", "EXPLAIN ANALYZE DELETE FROM ANN.AS_STAFF WHERE ID = 1")]).outcome.starts_with("blocked"));
    assert!(call("analyzer_findings", &[("schema", "ANN")]).content.starts_with('['));
}

/// The queries and drafts of `tools`: an approved query's rows bounded, an
/// unapproved one, a write and a hidden table's refused; a draft of a
/// DROP blocked and of no estimate, of a query estimated.
fn query_tools(tools: &SessionTools<'_>, yes: &Window) {
    let call = |name: &str, pairs: &[(&str, &str)], host: &dyn Host| tools.call(name, &input(pairs), host);
    let rows = call("run_query", &[("sql", "SELECT ID, NAME FROM ANN.AS_STAFF ORDER BY ID"), ("purpose", "see")], yes);
    assert_eq!(rows.outcome, "approved");
    assert_eq!(rows.content, "ID | NAME\n1 | Ada\n2 | Alan\n(the first 2 rows alone)");
    let no = Window { yes: false, told: RefCell::new(Vec::new()) };
    assert_eq!(call("run_query", &[("sql", "SELECT 1 FROM ANN.AS_STAFF"), ("purpose", "x")], &no).outcome, "refused by the user");
    assert_eq!(call("run_query", &[("sql", "DELETE FROM ANN.AS_STAFF"), ("purpose", "x")], yes).outcome, "blocked: HARD-FLOOR");
    assert_eq!(call("run_query", &[("sql", "SELECT * FROM AS_SECRETS"), ("purpose", "x")], yes).outcome, "blocked: HIDDEN");
    let drafted = call("propose_sql", &[("sql", "DROP TABLE ANN.AS_STAFF CASCADE"), ("title", "t"), ("why", "w")], yes);
    assert_eq!(drafted.outcome, "drafted");
    assert!(yes.told.borrow().iter().any(|e| matches!(e, TurnEvent::Draft { verdict, estimate: None, .. } if verdict.blocked)));
    call("propose_sql", &[("sql", "SELECT NAME FROM ANN.AS_STAFF"), ("title", "t"), ("why", "w")], yes);
    let estimate = yes.told.borrow().iter().find_map(|e| match e {
        TurnEvent::Draft { estimate: Some(top), .. } => Some(top.clone()),
        _ => None,
    });
    assert!(estimate.as_deref().is_some_and(|top| top.contains("Project")), "{estimate:?}");
}

/// [DESIGN] D55: the assistant's tools read the catalog, explain, run an
/// approved query READ ONLY with its rows bounded, and draft SQL; a write,
/// a hidden table and an unapproved query are refused, and the database
/// refuses a write on the assistant's connection too.
pub fn the_assistants_tools_run_read_only(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    for sql in [
        "CREATE TABLE ANN.AS_STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))",
        "CREATE TABLE ANN.AS_SECRETS (ID INTEGER PRIMARY KEY)",
        "INSERT INTO ANN.AS_STAFF VALUES (1, 'Ada'), (2, 'Alan'), (3, 'Amy')",
    ] {
        run(&manager, id, sql).unwrap_or_else(|e| panic!("{sql}: {}", e.message));
    }
    let policy = ConnectionPolicy {
        level: Level::ProposeChanges,
        hidden: vec!["ANN.AS_SECRETS".into()],
        limits: turborel_studio_core::assistant::policy::Limits { rows: 2, ..Default::default() },
        ..ConnectionPolicy::default()
    };
    let opened = open_session(&manager, &saved(live), (Some(&live.password()), None), &policy).unwrap();
    let tools = SessionTools {
        manager: &manager,
        connection: opened.connection,
        policy: &policy,
        environment: Environment::Development,
        schema: Some("ANN".into()),
    };
    let yes = Window { yes: true, told: RefCell::new(Vec::new()) };
    catalog_tools(&tools, &yes);
    query_tools(&tools, &yes);
    let refused = manager.run(opened.connection, "INSERT INTO ANN.AS_STAFF VALUES (9, 'Eve')", true);
    assert!(refused.is_err(), "the assistant's connection wrote");
    manager.close(opened.connection).unwrap();
    for sql in ["DROP TABLE ANN.AS_STAFF CASCADE", "DROP TABLE ANN.AS_SECRETS CASCADE"] {
        run(&manager, id, sql).unwrap();
    }
    manager.close(id).unwrap();
}

/// [DESIGN] D55: a turn of the tests' model server calls a tool on the
/// live server and answers with its result; the request carries the
/// schema's context as its cached system text.
pub fn a_turn_of_the_mock_model_calls_the_server(live: &Live) {
    let (manager, _) = live.manager();
    let policy = ConnectionPolicy { preview: false, ..ConnectionPolicy::default() };
    let opened = open_session(&manager, &saved(live), (Some(&live.password()), None), &policy).unwrap();
    let tools = SessionTools {
        manager: &manager,
        connection: opened.connection,
        policy: &policy,
        environment: Environment::Development,
        schema: Some("ANN".into()),
    };
    let mock = MockModel::start(vec![
        Answer::Stream(anthropic_stream("Looking.", &[("t1", "list_schemas", "{}")], "tool_use")),
        Answer::Stream(anthropic_stream("Your schema is ANN.", &[], "end_turn")),
    ]);
    let dir = std::env::temp_dir().join(format!("studio-live-audit-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let audit = turborel_studio_core::assistant::audit::audit(&dir);
    let endpoint = Endpoint { base: mock.url.clone(), wire: Wire::Anthropic, claude: true, key: Some(Secret::new("sk-test")) };
    let settings = AssistantSettings { enabled: true, ..AssistantSettings::default() };
    let parts = Parts { endpoint: &endpoint, settings: &settings, policy: &policy, connection: "live", audit: &audit };
    let window = Window { yes: true, told: RefCell::new(Vec::new()) };
    let mut conversation =
        Conversation { wire: Wire::Anthropic, messages: Vec::new(), context: "Schema ANN: 0 tables and views.\n".into() };
    run_turn(&mut conversation, &Prompt { text: "Which schema?".into(), ..Prompt::default() }, &parts, (&tools, &window)).unwrap();
    let second: Value = serde_json::from_str(&mock.taken()[1].body).unwrap();
    let result = second["messages"][2]["content"][0]["content"].as_str().unwrap_or_default().to_owned();
    assert!(result.contains("ANN"), "{result}");
    assert_eq!(second["system"][1]["cache_control"]["type"], "ephemeral");
    assert_eq!(audit.entries().unwrap().len(), 2);
    assert_eq!(audit.entries().unwrap()[0].usage.cache_read, 8);
    std::fs::remove_dir_all(&dir).unwrap();
    manager.close(opened.connection).unwrap();
}

/// The events `events` keeps until a turn of `service` ends, each question
/// answered yes; at most ten seconds.
fn told_until_ended(
    events: &turborel_studio_core::events::KeptEvents,
    service: &turborel_studio_core::assistant::service::Service,
) -> Vec<turborel_studio_core::events::Event> {
    use turborel_studio_core::events::Event;
    let mut told = Vec::new();
    for _ in 0..200 {
        told.extend(events.take());
        let asked: Vec<u64> = told.iter().filter_map(|e| if let Event::AssistantAsks { id, .. } = e { Some(*id) } else { None }).collect();
        for id in asked {
            service.answer(id, true);
        }
        if told.iter().any(|e| matches!(e, Event::Assistant { event: TurnEvent::Ended { .. }, .. })) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    told
}

/// [DESIGN] D55: a conversation is asked of a saved connection: refused
/// while the assistant is off, run on a thread of its own, its question to
/// send answered by its number, its events told, and forgotten.
pub fn a_conversation_runs_on_its_own_thread(live: &Live) {
    use std::sync::Arc;
    use turborel_studio_core::assistant::service::{Asked, Service};
    use turborel_studio_core::assistant::settings::{OwnModel, Provider};
    use turborel_studio_core::events::{Event, EventSink, KeptEvents};
    use turborel_studio_core::saved::{PasswordChange, SavedConnections};
    use turborel_studio_core::secrets::{MemorySecrets, SecretStore};

    let dir = std::env::temp_dir().join(format!("studio-live-service-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let secrets: Arc<dyn SecretStore> = Arc::new(MemorySecrets::default());
    let saved = Arc::new(SavedConnections::new(dir.join("connections.json"), Arc::clone(&secrets)));
    let kept = saved
        .save(SavedConnection { id: String::new(), ..self::saved(live) }, PasswordChange::Save(live.password().expose().to_owned()))
        .unwrap();
    let (manager, _) = live.manager();
    let events = Arc::new(KeptEvents::default());
    let sink: Arc<dyn EventSink> = events.clone();
    let service = Arc::new(Service::new(&dir, (Arc::clone(&saved), secrets), Arc::new(manager), sink));
    let asked = Asked { saved: kept.id.clone(), schema: Some("ANN".into()) };
    let prompt = Prompt { text: "Hello".into(), ..Prompt::default() };
    assert!(service.ask("c-1", &asked, prompt.clone()).unwrap_err().message.contains("the assistant is off"));
    let mock = MockModel::start(vec![Answer::Stream(anthropic_stream("Hello back.", &[], "end_turn"))]);
    let settings = AssistantSettings {
        enabled: true,
        provider: Provider::Own,
        own: OwnModel { base_url: mock.url.clone(), model: "local".into(), wire: Wire::Anthropic, tools: true },
        ..AssistantSettings::default()
    };
    service.assistant.keep(&settings).unwrap();
    assert!(service.ask("bad id!", &asked, prompt.clone()).is_err());
    service.ask("c-1", &asked, prompt).unwrap();
    let told = told_until_ended(&events, &service);
    assert!(
        told.iter().any(|e| matches!(e, Event::Assistant { event: TurnEvent::Text { text }, .. } if text == "Hello back.")),
        "{told:?}"
    );
    service.answer(999, true);
    service.forget("c-1");
    service.forget("c-1");
    assert_eq!(service.audit.entries().unwrap().len(), 1);
    std::fs::remove_dir_all(&dir).unwrap();
}
