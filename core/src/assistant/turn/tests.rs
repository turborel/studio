//! A turn of the conversation, of the tests' model server, a toolbox and a
//! window of their own.

use std::cell::RefCell;

use serde_json::{Map, Value};

use super::{Conversation, Host, Parts, Prompt, Question, ToolOutcome, Toolbox, TurnEvent, message_of, run_turn};
use crate::assistant::http::Endpoint;
use crate::assistant::mock::{Answer, MockModel, anthropic_stream, chat_stream};
use crate::assistant::policy::{ConnectionPolicy, Limits};
use crate::assistant::settings::{AssistantSettings, OwnModel, Provider};
use crate::assistant::wire::{Stop, Wire};
use crate::secret::Secret;

/// A window that answers `yes`, keeping what it was told and asked.
struct Window {
    yes: bool,
    told: RefCell<Vec<TurnEvent>>,
    asked: RefCell<Vec<Question>>,
}

impl Window {
    fn new(yes: bool) -> Window {
        Window { yes, told: RefCell::new(Vec::new()), asked: RefCell::new(Vec::new()) }
    }
}

impl Host for Window {
    fn tell(&self, event: TurnEvent) {
        self.told.borrow_mut().push(event);
    }
    fn ask(&self, question: Question) -> bool {
        self.asked.borrow_mut().push(question);
        self.yes
    }
}

/// A toolbox that answers each call by its tool's name.
struct Echo;

impl Toolbox for Echo {
    fn call(&self, name: &str, input: &Map<String, Value>, _host: &dyn Host) -> ToolOutcome {
        ToolOutcome { content: format!("{name} of {}", Value::Object(input.clone())), is_error: false, outcome: "ran".into() }
    }
}

/// A conversation of `wire`.
fn conversation(wire: Wire) -> Conversation {
    Conversation { wire, messages: Vec::new(), context: "Schema ANN: 0 tables and views.\n".into() }
}

/// Claude's endpoint at `mock`.
fn claude(mock: &MockModel) -> Endpoint {
    Endpoint { base: mock.url.clone(), wire: Wire::Anthropic, claude: true, key: Some(Secret::new("sk")) }
}

/// [DESIGN] D55: a turn asks the model, shows each request first, runs the
/// tool it calls, sends its result back, ends with the model's answer, and
/// logs each request.
#[test]
fn a_turn_runs_a_tool_and_answers() {
    let mock = MockModel::start(vec![
        Answer::Stream(anthropic_stream("Let me look.", &[("t1", "describe_table", r#"{"schema":"ANN","table":"STAFF"}"#)], "tool_use")),
        Answer::Stream(anthropic_stream("STAFF has two columns.", &[], "end_turn")),
    ]);
    let dir = crate::testing::scratch("assistant/turn");
    let audit = crate::assistant::audit::audit(&dir);
    let settings = AssistantSettings { enabled: true, ..AssistantSettings::default() };
    let policy = ConnectionPolicy::default();
    let parts = Parts { endpoint: &claude(&mock), settings: &settings, policy: &policy, connection: "local", audit: &audit };
    let window = Window::new(true);
    let mut talk = conversation(Wire::Anthropic);
    let prompt = Prompt { text: "Describe STAFF".into(), sql: Some("SELECT * FROM STAFF WHERE ID = 3".into()), ..Prompt::default() };
    run_turn(&mut talk, &prompt, &parts, (&Echo, &window)).unwrap();
    assert_eq!(talk.messages.len(), 4);
    assert_eq!(talk.messages[2]["content"][0]["content"], r#"describe_table of {"schema":"ANN","table":"STAFF"}"#);
    let told = window.told.borrow();
    assert!(told.contains(&TurnEvent::Tool { name: "describe_table".into(), outcome: "ran".into() }));
    assert!(matches!(told.last(), Some(TurnEvent::Ended { stop: Stop::EndTurn, usage }) if usage.input == 20));
    assert_eq!(window.asked.borrow().len(), 2);
    let taken = mock.taken();
    let first: Value = serde_json::from_str(&taken[0].body).unwrap();
    assert!(first["messages"][0]["content"].as_str().is_some_and(|c| c.contains("WHERE ID = 3")));
    assert_eq!(first["output_config"]["effort"], "medium");
    let entries = audit.entries().unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[1].tools[0].name, "describe_table");
    assert_eq!(entries[0].sent, ["schema", "sql"]);
}

/// [DESIGN] D55: a request the user does not let be sent is never sent,
/// and the question is let go; a refusal is told and its tools never run.
#[test]
fn a_request_unseen_is_not_sent_and_a_refusal_runs_nothing() {
    let mock = MockModel::start(vec![Answer::Stream(
        "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"t\",\"name\":\"list_schemas\",\"input\":{}}}\n\n\
event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"refusal\",\"stop_details\":{\"category\":\"cyber\",\"explanation\":\"declined\"}}}\n\n"
            .to_owned(),
    )]);
    let dir = crate::testing::scratch("assistant/refused");
    let audit = crate::assistant::audit::audit(&dir);
    let settings = AssistantSettings::default();
    let policy = ConnectionPolicy::default();
    let parts = Parts { endpoint: &claude(&mock), settings: &settings, policy: &policy, connection: "local", audit: &audit };
    let mut talk = conversation(Wire::Anthropic);
    let declining = Window::new(false);
    run_turn(&mut talk, &Prompt { text: "Hi".into(), ..Prompt::default() }, &parts, (&Echo, &declining)).unwrap();
    assert_eq!((talk.messages.len(), mock.taken().len()), (0, 0));
    assert_eq!(audit.entries().unwrap()[0].stop, "not sent");
    let unshown = ConnectionPolicy { preview: false, ..ConnectionPolicy::default() };
    let parts = Parts { policy: &unshown, ..parts };
    let window = Window::new(true);
    run_turn(
        &mut talk,
        &Prompt { text: "Hi".into(), explain: Some("SeqScan ANN.T".into()), ..Prompt::default() },
        &parts,
        (&Echo, &window),
    )
    .unwrap();
    let told = window.told.borrow();
    assert!(told.contains(&TurnEvent::Refused { category: Some("cyber".into()), explanation: Some("declined".into()) }));
    assert!(!told.iter().any(|e| matches!(e, TurnEvent::Tool { .. })));
    assert_eq!(talk.messages.len(), 1);
    let sent: Value = serde_json::from_str(&mock.taken()[0].body).unwrap();
    assert_eq!(sent["output_config"]["effort"], "high");
    let entries = audit.entries().unwrap();
    assert_eq!((entries.len(), entries[0].stop.as_str()), (2, "refusal"));
}

/// [DESIGN] D55: an input that does not fit its tool is told to the model,
/// never run; the tool calls of a turn stop at their limit; a model of
/// chat completions that calls no tools is asked with none.
#[test]
fn inputs_are_checked_calls_limited_and_tools_left_out() {
    let calls = [("a", "list_schemas", "{}"), ("b", "explain", "{\"sql\": 7}"), ("c", "list_schemas", "{}")];
    let mock = MockModel::start(vec![
        Answer::Stream(chat_stream("", &calls, "tool_calls")),
        Answer::Stream(chat_stream("Done.", &[], "stop")),
        Answer::Stream(chat_stream("Plain.", &[], "stop")),
    ]);
    let dir = crate::testing::scratch("assistant/limits");
    let audit = crate::assistant::audit::audit(&dir);
    let own = AssistantSettings {
        provider: Provider::Own,
        own: OwnModel { model: "local".into(), ..OwnModel::default() },
        ..AssistantSettings::default()
    };
    let policy = ConnectionPolicy { preview: false, limits: Limits { tool_calls: 2, ..Limits::default() }, ..ConnectionPolicy::default() };
    let endpoint = Endpoint { base: mock.url.clone(), wire: Wire::ChatCompletions, claude: false, key: None };
    let parts = Parts { endpoint: &endpoint, settings: &own, policy: &policy, connection: "local", audit: &audit };
    let window = Window::new(true);
    let mut talk = conversation(Wire::ChatCompletions);
    run_turn(&mut talk, &Prompt { text: "Go".into(), ..Prompt::default() }, &parts, (&Echo, &window)).unwrap();
    let outcomes: Vec<String> = window
        .told
        .borrow()
        .iter()
        .filter_map(|e| match e {
            TurnEvent::Tool { outcome, .. } => Some(outcome.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(outcomes, ["ran", "input that did not fit", "blocked: LIMIT"]);
    let silent = AssistantSettings { own: OwnModel { tools: false, ..own.own.clone() }, ..own.clone() };
    let parts = Parts { settings: &silent, ..parts };
    run_turn(&mut talk, &Prompt { text: "Again".into(), ..Prompt::default() }, &parts, (&Echo, &window)).unwrap();
    let last: Value = serde_json::from_str(&mock.taken()[2].body).unwrap();
    assert!(last.get("tools").is_none());
    assert_eq!(last["model"], "local");
}

/// [DESIGN] D55: the user's message holds what they chose to send, its
/// literals redacted where the policy says, and the kinds sent named.
#[test]
fn a_message_holds_what_was_chosen() {
    let prompt = Prompt {
        text: "Why?".into(),
        sql: Some("SELECT * FROM T WHERE A = 'secret'".into()),
        explain: Some("Filter T.A = 'secret'".into()),
        rows: Some("A\nx".into()),
    };
    let (text, sent) = message_of(&prompt, true);
    assert!(!text.contains("secret"));
    assert!(text.contains("WHERE A = ?") && text.contains("Rows of its result"));
    assert_eq!(sent, ["schema", "sql", "explain", "rows"]);
    assert!(message_of(&prompt, false).0.contains("'secret'"));
    let failed = super::failed(&crate::error::StudioError::misuse("gone"));
    assert!(matches!(failed, TurnEvent::Ended { stop: Stop::Other { reason }, .. } if reason == "gone"));
}
