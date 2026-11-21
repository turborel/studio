//! The scenes of the assistant (RULES.md D60), answered by a model of
//! the scenes' own, core's mock model, never a real one: its settings;
//! what will be sent; a question answered with its tool calls; a query it
//! asks to run; a DROP blocked by its rule; and its log.

use std::path::Path;

use turborel_studio_core::assistant::mock::{Answer, chat_stream};

use crate::error::{Error, Result};
use crate::screenshots::connections::DIALOG;
use crate::screenshots::scene::Scene;

/// The assistant's panel.
const PANEL: &str = "[role=\"region\"][aria-label=\"Assistant\"]";

/// The answers of the scenes' model, in the order the scenes ask: each
/// question's tool call, then its answer.
pub fn answers() -> Vec<Answer> {
    let describe = r#"{"schema":"DEMO","table":"ORDERS"}"#;
    let count =
        r#"{"sql":"SELECT CITY, COUNT(*) AS CUSTOMERS FROM CUSTOMERS GROUP BY CITY","purpose":"To count the customers of each city."}"#;
    let drop = r#"{"sql":"DROP TABLE ORDER_LINES","purpose":"To start the lines afresh."}"#;
    [
        chat_stream("Let me read the table ORDERS first.", &[("call_1", "describe_table", describe)], "tool_calls"),
        chat_stream(
            "ORDERS holds each order's customer, date and total. Its key is ID, and ORDERS_BY_CUSTOMER indexes CUSTOMER_ID, so a join of the customers and their orders looks each customer's orders up in the index.",
            &[],
            "stop",
        ),
        chat_stream("I'll count them.", &[("call_2", "run_query", count)], "tool_calls"),
        chat_stream("The customers are in eight cities, one in each.", &[], "stop"),
        chat_stream("I'll drop the lines.", &[("call_3", "run_query", drop)], "tool_calls"),
        chat_stream("I may not drop a table; a person who may would run DROP TABLE ORDER_LINES.", &[], "stop"),
    ]
    .into_iter()
    .map(Answer::Stream)
    .collect()
}

/// Writes the assistant's settings to `config`: on, of the user's own
/// model at `endpoint`.
pub fn write_settings(config: &Path, endpoint: &str) -> Result<()> {
    let settings = serde_json::json!({
        "format": 1,
        "enabled": true,
        "provider": "own",
        "claudeModel": "claude-opus-5-5",
        "own": {"baseUrl": endpoint, "model": "demo-model", "wire": "chatCompletions", "tools": true}
    });
    std::fs::write(config.join("assistant.json"), settings.to_string()).map_err(|e| Error(format!("assistant.json: {e}")))
}

/// The assistant's settings: the user's own model, and the connection's policy.
pub fn settings_scene(scene: &Scene<'_>) -> Result<()> {
    write_settings(scene.config, "http://localhost:11434")?;
    scene.command("Assistant Settings…")?;
    scene.session.wait_for(DIALOG)?;
    scene.save_part("assistant-settings", DIALOG)?;
    scene.escape()?;
    write_settings(scene.config, scene.model)
}

/// Sends the request shown, as Send does.
fn send(scene: &Scene<'_>) -> Result<()> {
    scene.click_shown("[role=\"group\"][aria-label=\"What will be sent\"] .dialog-buttons button:last-child")
}

/// Asks `question` in the panel.
fn ask(scene: &Scene<'_>, question: &str) -> Result<()> {
    scene.session.wait_for("textarea[aria-label=\"Ask the assistant\"]")?;
    scene.session.click("textarea[aria-label=\"Ask the assistant\"]")?;
    scene.session.type_into("textarea[aria-label=\"Ask the assistant\"]", question)?;
    scene.click_shown("form.assistant-composer button[type=\"submit\"]")
}

/// A question answered: what will be sent shown first, the table
/// described by a tool, and the answer; a picture of what will be sent,
/// and an animation of the panel.
pub fn question_scene(scene: &Scene<'_>) -> Result<()> {
    scene.command("Assistant")?;
    scene.session.wait_for(PANEL)?;
    let area = scene.area(PANEL)?;
    let mut film = scene.film(Some(area));
    ask(scene, "How are the orders found by their customer?")?;
    scene.session.wait_for("[role=\"group\"][aria-label=\"What will be sent\"]")?;
    film.frame(200)?;
    scene.save_part("assistant-preview", "[role=\"group\"][aria-label=\"What will be sent\"]")?;
    send(scene)?;
    scene.wait_text("li.assistant-tool", "describe_table")?;
    film.frame(150)?;
    send(scene)?;
    scene.wait_text("ul[aria-label=\"Conversation\"] li.hint", "tokens")?;
    film.frame(400)?;
    film.write("assistant-question", None)
}

/// A query the assistant asks to run, READ ONLY, asked about first.
pub fn approval_scene(scene: &Scene<'_>) -> Result<()> {
    ask(scene, "How many customers are in each city?")?;
    send(scene)?;
    scene.session.wait_for("[role=\"group\"][aria-label=\"Run the query?\"]")?;
    scene.save_part("assistant-approval", PANEL)?;
    scene.click_shown("[role=\"group\"][aria-label=\"Run the query?\"] .dialog-buttons button:last-child")?;
    send(scene)?;
    scene.wait_text("ul[aria-label=\"Conversation\"]", "eight cities")
}

/// A DROP the model calls for, blocked by the hard floor's rule.
pub fn blocked_scene(scene: &Scene<'_>) -> Result<()> {
    ask(scene, "Drop the order lines.")?;
    send(scene)?;
    scene.wait_text("li.assistant-tool", "HARD-FLOOR")?;
    send(scene)?;
    scene.wait_text("ul[aria-label=\"Conversation\"]", "may not drop")?;
    scene.save_part("assistant-blocked", PANEL)
}

/// The assistant's log: each request, its model, what it sent, its tools
/// and its tokens.
pub fn log_scene(scene: &Scene<'_>) -> Result<()> {
    scene.command("Assistant Settings…")?;
    scene.session.wait_for(DIALOG)?;
    scene.click_text("[role=\"dialog\"] button", "Show the Log")?;
    scene.session.wait_for("table[aria-label^=\"The assistant\"]")?;
    scene
        .session
        .script("document.querySelector('table[aria-label^=\"The assistant\"]').closest('fieldset').scrollIntoView({block: 'start'});")?;
    scene.save_part("assistant-log", "fieldset:has(table[aria-label^=\"The assistant\"])")?;
    scene.escape()
}
