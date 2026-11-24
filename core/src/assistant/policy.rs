//! The assistant's guard rails (RULES.md D55), enforced in code and never
//! by the prompt: each connection's policy, of its level, lists and
//! limits, kept in `assistant-policy.json`, format 1; and each statement
//! the assistant asks to explain, run or propose judged by it, classified
//! by Turborel's own parser (D29). A statement the hard floor holds, one
//! that does not parse, and dynamic SQL the assistant can never run, and a
//! draft of one is marked blocked, run only by the user, who types its
//! object's name. A script of more than one statement is never run.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use turborel::lexer::{Tok, lex};

use crate::error::{Result, StudioError};
use crate::guard::classify::{Class, Classified, classify_script, strictest};
use crate::saved::Environment;
use crate::store::{self, FORMAT};

/// The policy's file.
pub const POLICY_FILE: &str = "assistant-policy.json";
/// The longest the policy's file may be, in bytes.
const MAX_POLICY_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// The most connections a policy names.
const MAX_CONNECTIONS: usize = 1000;
/// The most entries of a list.
const MAX_LIST: usize = 500;
/// The longest name of a list, in characters.
const MAX_NAME_CHARS: usize = 400;

/// How much the assistant may do on a connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    /// No assistant.
    Off,
    /// The catalog, EXPLAIN and the analyzer's findings; no queries.
    ExplainOnly,
    /// And SELECTs the user approves, in a READ ONLY transaction.
    Read,
    /// And drafts of writes and definitions, which the user runs.
    ProposeChanges,
}

/// The limits on what the assistant reads and spends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Limits {
    /// The most rows a query returns to the model.
    pub rows: u32,
    /// The most seconds a query of the assistant's runs before it is cancelled.
    pub statement_seconds: u32,
    /// The most tool calls of a turn.
    pub tool_calls: u32,
    /// The most output tokens a request asks for.
    pub tokens: u32,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits { rows: 100, statement_seconds: 30, tool_calls: 20, tokens: 64_000 }
    }
}

/// The bounds of each limit, least and most.
const LIMIT_BOUNDS: [(&str, u32, u32); 4] =
    [("rows", 1, 10_000), ("statement seconds", 1, 3600), ("tool calls", 1, 100), ("tokens", 1024, 128_000)];

/// A connection's policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct ConnectionPolicy {
    /// How much the assistant may do.
    pub level: Level,
    /// Whether what will be sent is shown before each request.
    pub preview: bool,
    /// Whether SQL's literals are replaced by placeholders before they are sent.
    pub redact_literals: bool,
    /// The classes of statements the assistant may run or draft; all if empty.
    pub allow_classes: Vec<Class>,
    /// The classes it may not.
    pub deny_classes: Vec<Class>,
    /// The schemas or tables, `SCHEMA` or `SCHEMA.TABLE`, it may run
    /// statements of; all if empty.
    pub allow_objects: Vec<String>,
    /// The schemas or tables it may not run statements of.
    pub deny_objects: Vec<String>,
    /// The schemas or tables it may not read at all, nor be told of.
    pub hidden: Vec<String>,
    /// The limits on what it reads and spends.
    pub limits: Limits,
    /// The login its queries run as, on a connection of their own, where
    /// one is named: its password in the keychain.
    pub login: Option<String>,
}

impl Default for ConnectionPolicy {
    fn default() -> ConnectionPolicy {
        ConnectionPolicy::for_environment(Environment::Development)
    }
}

impl ConnectionPolicy {
    /// The policy a connection of `environment` starts with: Read, but
    /// Off on production, whose literals are redacted.
    pub fn for_environment(environment: Environment) -> ConnectionPolicy {
        let production = environment == Environment::Production;
        ConnectionPolicy {
            level: if production { Level::Off } else { Level::Read },
            preview: true,
            redact_literals: production,
            allow_classes: Vec::new(),
            deny_classes: Vec::new(),
            allow_objects: Vec::new(),
            deny_objects: Vec::new(),
            hidden: Vec::new(),
            limits: Limits::default(),
            login: None,
        }
    }

    /// The level the policy gives on a connection of `environment`: at
    /// most Read on production, whatever the file says.
    pub fn level_on(&self, environment: Environment) -> Level {
        if environment == Environment::Production { self.level.min(Level::Read) } else { self.level }
    }

    /// Checks the policy's bounds.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a list too long, a name out of its bounds, or a limit
    /// out of its bounds.
    pub fn validate(&self) -> Result<()> {
        for (what, list) in [("allowed", &self.allow_objects), ("denied", &self.deny_objects), ("hidden", &self.hidden)] {
            if list.len() > MAX_LIST {
                return Err(StudioError::misuse(format!("[DESIGN] at most {MAX_LIST} {what} objects")));
            }
            if list.iter().any(|n| n.is_empty() || n.chars().count() > MAX_NAME_CHARS || n.chars().any(char::is_control)) {
                return Err(StudioError::misuse(format!("[DESIGN] each {what} object is 1 to {MAX_NAME_CHARS} characters")));
            }
        }
        let l = self.limits;
        for ((name, low, high), value) in LIMIT_BOUNDS.iter().zip([l.rows, l.statement_seconds, l.tool_calls, l.tokens]) {
            if value < *low || value > *high {
                return Err(StudioError::misuse(format!("[DESIGN] the limit of {name} is from {low} to {high}")));
            }
        }
        if self.login.as_ref().is_some_and(|n| n.is_empty() || n.chars().count() > MAX_NAME_CHARS) {
            return Err(StudioError::misuse("[DESIGN] the assistant's login is 1 to 400 characters"));
        }
        Ok(())
    }
}

/// The policy's file: each saved connection's policy, by its identifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyFile {
    /// The file's format.
    pub format: u32,
    /// Each saved connection's policy.
    pub connections: BTreeMap<String, ConnectionPolicy>,
}

/// The policies, in a directory of the user's own.
#[derive(Debug, Clone)]
pub struct Policies {
    path: PathBuf,
}

impl Policies {
    /// The policies kept in `dir`.
    pub fn new(dir: &Path) -> Policies {
        Policies { path: dir.join(POLICY_FILE) }
    }

    /// Every policy kept.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read.
    pub fn all(&self) -> Result<PolicyFile> {
        Ok(store::read::<PolicyFile>(&self.path, MAX_POLICY_FILE_BYTES)?
            .unwrap_or(PolicyFile { format: FORMAT, connections: BTreeMap::new() }))
    }

    /// The policy of saved connection `id`, of `environment`: its own, or
    /// the environment's to begin with. One not saved has the environment's.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read.
    pub fn of(&self, id: Option<&str>, environment: Environment) -> Result<ConnectionPolicy> {
        let kept = id.and_then(|id| self.all().ok()?.connections.remove(id));
        Ok(kept.unwrap_or_else(|| ConnectionPolicy::for_environment(environment)))
    }

    /// Keeps `policy` as saved connection `id`'s.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a policy out of its bounds, too many, or a file that
    /// cannot be read or written.
    pub fn keep(&self, id: &str, policy: ConnectionPolicy) -> Result<PolicyFile> {
        policy.validate()?;
        let mut file = self.all()?;
        if !file.connections.contains_key(id) && file.connections.len() >= MAX_CONNECTIONS {
            return Err(StudioError::misuse(format!("[DESIGN] at most {MAX_CONNECTIONS} connections' policies are kept")));
        }
        file.connections.insert(id.to_owned(), policy);
        store::write(&self.path, &file)?;
        Ok(file)
    }

    /// Takes the policies of `file` in place of those kept, as one exported
    /// was.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a file of another format, a policy out of its
    /// bounds, or a file that cannot be written.
    pub fn replace(&self, file: &PolicyFile) -> Result<()> {
        if file.format != FORMAT {
            return Err(StudioError::misuse(format!("[DESIGN] a policy file of format {} is not read", file.format)));
        }
        if file.connections.len() > MAX_CONNECTIONS {
            return Err(StudioError::misuse(format!("[DESIGN] at most {MAX_CONNECTIONS} connections' policies are kept")));
        }
        file.connections.values().try_for_each(ConnectionPolicy::validate)?;
        store::write(&self.path, file)
    }
}

/// What the assistant asks to do with a statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Use {
    /// EXPLAIN it, without ANALYZE, which reads nothing of its rows and
    /// runs nothing, a data change's no more than a query's.
    Explain,
    /// Run it, the user approving, in a READ ONLY transaction.
    Run,
    /// Draft it into a worksheet, for the user to run.
    Propose,
}

/// The policy's verdict of a statement: whether the use is allowed, the
/// rule that stopped it, and what the statement is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    /// Whether the use is allowed.
    pub allowed: bool,
    /// The rule that stopped it, if one did, as `HARD-FLOOR`.
    pub rule: Option<String>,
    /// Why, in words.
    pub why: Option<String>,
    /// The strictest class of its statements.
    pub class: Class,
    /// The objects its statements name, as written.
    pub objects: Vec<String>,
    /// Whether a draft of it is blocked for the assistant: run by the user
    /// alone, who types `confirm` first.
    pub blocked: bool,
    /// What the user types to run a blocked draft: its object's name, or
    /// its first word.
    pub confirm: Option<String>,
    /// Its statements, classified.
    pub statements: Vec<Classified>,
}

/// The names a statement's words hold: each identifier, and each pair of
/// identifiers about a period, `SCHEMA.TABLE`; upper case as Turborel
/// reads a regular identifier.
pub fn named_objects(text: &str) -> Vec<String> {
    let Ok(tokens) = lex(text) else { return Vec::new() };
    let mut names: Vec<String> =
        tokens.iter().filter_map(|t| if let Tok::Identifier(name) = &t.tok { Some(name.clone()) } else { None }).collect();
    for three in tokens.windows(3) {
        if let [first, dot, next] = three
            && let (Tok::Identifier(name), Tok::Delimiter("."), Tok::Identifier(after)) = (&first.tok, &dot.tok, &next.tok)
        {
            names.push(format!("{name}.{after}"));
        }
    }
    names.sort();
    names.dedup();
    names
}

/// Whether `name`, `SCHEMA.TABLE` or a lone identifier, falls under `rule`,
/// `SCHEMA` or `SCHEMA.TABLE`: a lone name meets a rule of its table or its
/// schema, so a name never written with its schema is still caught.
fn covers(rule: &str, name: &str) -> bool {
    let rule = rule.to_uppercase();
    let name = name.to_uppercase();
    match (rule.split_once('.'), name.split_once('.')) {
        (Some(_), Some(_)) | (None, None) => rule == name,
        (Some((_, table)), None) => table == name,
        (None, Some((schema, _))) => schema == rule,
    }
}

/// The verdict of `script`'s use `use_` under `policy`, on a connection of
/// `environment` whose session's schema is `schema`: a name written alone
/// is judged as of that schema too.
pub fn judge(policy: &ConnectionPolicy, environment: Environment, (use_, schema): (Use, Option<&str>), script: &str) -> Verdict {
    let statements = classify_script(script);
    let class = if statements.is_empty() { Class::Unclassified } else { strictest(&statements) };
    let mut objects = named_objects(script);
    if let Some(schema) = schema {
        let alone: Vec<String> = objects.iter().filter(|n| !n.contains('.')).map(|n| format!("{schema}.{n}")).collect();
        objects.extend(alone);
        objects.sort();
        objects.dedup();
    }
    let floor = statements.iter().find_map(|s| s.floor.clone());
    let blocked = floor.is_some() || class == Class::Unclassified;
    let confirm = blocked.then(|| {
        statements
            .iter()
            .find(|s| s.floor.is_some() || s.class == Class::Unclassified)
            .and_then(|s| s.object.clone().or_else(|| s.text.split_whitespace().next().map(str::to_uppercase)))
            .unwrap_or_else(|| "RUN".to_owned())
    });
    let base = Verdict { allowed: true, rule: None, why: None, class, objects, blocked, confirm, statements };
    match stopped(policy, environment, use_, &base, floor.as_deref()) {
        Some((rule, why)) => Verdict { allowed: false, rule: Some(rule.to_owned()), why: Some(why), ..base },
        None => base,
    }
}

/// The rule that stops `verdict`'s use, and why; none if it is allowed.
fn stopped(
    policy: &ConnectionPolicy,
    environment: Environment,
    use_: Use,
    verdict: &Verdict,
    floor: Option<&str>,
) -> Option<(&'static str, String)> {
    let level = policy.level_on(environment);
    let class = verdict.class;
    if level == Level::Off {
        return Some(("ASSISTANT-OFF", "the assistant is off on this connection".to_owned()));
    }
    if verdict.statements.len() > 1 && use_ != Use::Propose {
        return Some(("ONE-STATEMENT", "the assistant explains or runs one statement at a time".to_owned()));
    }
    if let Some(found) = verdict.objects.iter().find(|n| policy.hidden.iter().any(|h| covers(h, n))) {
        return Some(("HIDDEN", format!("{found} is hidden from the assistant")));
    }
    if use_ != Use::Propose {
        if let Some(what) = floor {
            return Some(("HARD-FLOOR", format!("the assistant can never run {what}")));
        }
        // Plain EXPLAIN of a data change runs nothing (D70), so the
        // assistant may explain one; it runs queries alone.
        let explains_change = use_ == Use::Explain && class == Class::WriteRows;
        if class != Class::Read && !explains_change {
            return Some((
                "READ-ONLY",
                format!("the assistant runs queries alone, and explains queries and data changes alone, and this is {class:?}"),
            ));
        }
    }
    let needed = match use_ {
        Use::Explain => Level::ExplainOnly,
        Use::Run => Level::Read,
        Use::Propose if class == Class::Read => Level::ExplainOnly,
        Use::Propose => Level::ProposeChanges,
    };
    if level < needed {
        return Some(("LEVEL", format!("the connection's level, {level:?}, does not allow this; {needed:?} does")));
    }
    if policy.deny_classes.contains(&class) || (!policy.allow_classes.is_empty() && !policy.allow_classes.contains(&class)) {
        return Some(("CLASS", format!("statements of class {class:?} are not allowed to the assistant")));
    }
    if let Some(found) = verdict.objects.iter().find(|n| policy.deny_objects.iter().any(|d| covers(d, n))) {
        return Some(("DENIED", format!("{found} is denied to the assistant")));
    }
    let outside = !policy.allow_objects.is_empty()
        && use_ != Use::Propose
        && !verdict.objects.iter().any(|n| policy.allow_objects.iter().any(|a| covers(a, n)));
    if outside {
        return Some(("NOT-ALLOWED", "the statement names no object allowed to the assistant".to_owned()));
    }
    None
}

#[cfg(test)]
mod tests;
