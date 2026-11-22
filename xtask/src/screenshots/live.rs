//! The scenes of Live Sessions (RULES.md D60), a viewer joined by this
//! program through Studio's own guest, `turborel-studio-live`: a session
//! presented and its invitation; a viewer asking to join and admitted; a
//! suggestion of the viewer's landing in the presenter's worksheet; the
//! settings and their masks; the session's record replayed, and its
//! summary for a ticket; and the join dialog of the invitation's link.

use std::sync::{Arc, Mutex};

use serde_json::Value;
use turborel_studio_live::guest::{Guest, GuestEvent};
use turborel_studio_live::invite::Invite;

use crate::error::{Error, Result, fail};
use crate::screenshots::connections::DIALOG;
use crate::screenshots::scene::{SETTLE, Scene};

/// The Live Session panel.
const PANEL: &str = "[role=\"region\"][aria-label=\"Live Session\"]";
/// The viewer's name.
const VIEWER: &str = "Ann";

/// Live Sessions: a session presented, its panel shown; and its
/// invitation, its link kept for the scene of a link.
pub fn present_scene(scene: &Scene<'_>) -> Result<()> {
    // A worksheet of a query and its rows, to be shared.
    scene.result(crate::screenshots::worksheets::QUERY, "Run Statement")?;
    scene.session.click("[role=\"toolbar\"][aria-label=\"Toolbar\"] button[aria-label=\"Present\"]")?;
    scene.session.wait_for(&format!("{PANEL} [aria-label=\"Participants\"]"))?;
    scene.save("live-session")?;
    scene.click_text(&format!("{PANEL} button"), "New Invitation")?;
    scene.session.wait_for("textarea[aria-label=\"Invitation code\"]")?;
    scene.save_part("live-invite", &format!("{PANEL} section[aria-label=\"Invitation\"]"))?;
    let code = scene.session.script("return document.querySelector('textarea[aria-label=\"Invitation code\"]').value;")?;
    let code = code.as_str().unwrap_or_default().to_owned();
    let link = format!("turborel-studio://join?code={}", code.strip_prefix("turborel-live:").unwrap_or(&code));
    if let Ok(mut kept) = scene.link.lock() {
        *kept = Some(link);
    }
    Ok(())
}

/// A viewer of the session: its runtime, its guest, and the presenter's
/// workspace as it last came.
struct Viewer {
    // The guest ends before the runtime it runs on, as fields end in turn.
    guest: Guest,
    state: Arc<Mutex<Option<Value>>>,
    runtime: tokio::runtime::Runtime,
}

impl Viewer {
    /// Joins the session of the invitation `code` as `VIEWER`.
    fn join(code: &str) -> Result<Viewer> {
        let invite = Invite::read(code).map_err(|e| Error(format!("the invitation: {e}")))?;
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .thread_name("screenshots-viewer")
            .enable_all()
            .build()
            .map_err(|e| Error(format!("the viewer's runtime: {e}")))?;
        let state = Arc::new(Mutex::new(None));
        let kept = Arc::clone(&state);
        let on = Arc::new(move |event: GuestEvent| {
            if let (GuestEvent::State { state, .. }, Ok(mut last)) = (event, kept.lock()) {
                *last = Some(state);
            }
        });
        let guest = runtime
            .block_on(async { Guest::join(&invite, VIEWER, on).await })
            .map_err(|e| Error(format!("the viewer could not join: {e}")))?;
        Ok(Viewer { guest, state, runtime })
    }

    /// The first tab the presenter shares, once one is.
    fn tab(&self) -> Result<String> {
        for _ in 0..40 {
            let tab = self.state.lock().ok().and_then(|s| s.as_ref()?.pointer("/tabs/0/id")?.as_str().map(str::to_owned));
            if let Some(tab) = tab {
                return Ok(tab);
            }
            std::thread::sleep(SETTLE);
        }
        fail("the presenter shared no tab")
    }
}

impl Drop for Viewer {
    fn drop(&mut self) {
        // Within the runtime, the guest's own: its goodbye sent and let go
        // before the runtime ends. A failure here, of a scene failing
        // already, is let pass, so the run goes on to the next scene.
        let (guest, runtime) = (&self.guest, &self.runtime);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _inside = runtime.enter();
            guest.leave();
            runtime.block_on(async { tokio::time::sleep(SETTLE).await });
        }));
    }
}

/// Shares the presenter's first worksheet in the session.
fn share_worksheet(scene: &Scene<'_>) -> Result<()> {
    let script = format!(
        "const f = [...document.querySelectorAll('{0} fieldset')].find((f) => f.querySelector('legend')?.textContent.includes('Shared tabs')); const c = f?.querySelector('label.check input'); if (!c) return false; if (!c.checked) c.click(); return true;",
        PANEL.replace('\'', "\\'")
    );
    scene.until(&script, "the panel offered no tab to share")
}

/// A viewer asks to join and is admitted, let suggest, and suggests a
/// query, which lands in the presenter's panel and opens in a worksheet
/// of its own: a picture of the asking, and an animation.
pub fn suggestion_scene(scene: &Scene<'_>) -> Result<()> {
    let code = scene.session.script("return document.querySelector('textarea[aria-label=\"Invitation code\"]')?.value ?? '';")?;
    let viewer = Viewer::join(code.as_str().unwrap_or_default())?;
    scene.session.wait_for("section[aria-label=\"Asking to join\"]")?;
    scene.save_part("live-admit", "section[aria-label=\"Asking to join\"]")?;
    scene.click_exact("section[aria-label=\"Asking to join\"] button", "Admit")?;
    scene.click_text("[aria-label=\"Participants\"] li.live-participant label.check", "May suggest")?;
    share_worksheet(scene)?;
    let tab = viewer.tab()?;
    let mut film = scene.film(None);
    film.frame(150)?;
    let _inside = viewer.runtime.enter();
    viewer.guest.suggest(&tab, "SELECT NAME, CITY FROM CUSTOMERS WHERE CITY IN ('Lisbon', 'Porto') ORDER BY NAME");
    scene.session.wait_for("section[aria-label=\"Suggestions\"]")?;
    film.frame(250)?;
    scene.click_text("section[aria-label=\"Suggestions\"] button", "Open in Worksheet")?;
    scene.wait_text("[role=\"tab\"]", "Suggested by")?;
    film.frame(350)?;
    film.write("live-suggestion", None)
}

/// The settings of Live Sessions, their masked columns among them.
pub fn settings_scene(scene: &Scene<'_>) -> Result<()> {
    scene.command("Live Sessions Settings…")?;
    scene.session.wait_for(DIALOG)?;
    scene.wait_text("[role=\"dialog\"] fieldset", "Masked columns")?;
    scene.session.script("document.getElementById('studio-target')?.scrollIntoView({block: 'start'});")?;
    scene.save_part("live-settings", DIALOG)?;
    scene.escape()
}

/// The session ended, its record replayed, and its summary for a ticket.
pub fn records_scene(scene: &Scene<'_>) -> Result<()> {
    scene.click_text(&format!("{PANEL} button.danger"), "End Session")?;
    scene.command("Session Records…")?;
    scene.click_text("ul[aria-label=\"Records\"] button", "presented by")?;
    scene.session.wait_for(".live-replay")?;
    scene.click_text("section[aria-label=\"Timeline\"] button", "suggested")?;
    scene.save_part("live-replay", DIALOG)?;
    scene.click_text("[role=\"dialog\"] button", "Summary for a Ticket…")?;
    scene.fill("Conclusions", "Lisbon's and Porto's customers are the shop's first in Portugal.")?;
    scene.session.wait_for("pre[aria-label=\"Summary preview\"]")?;
    scene.save_part("live-summary", "section[aria-label=\"Summary for a ticket\"]")?;
    scene.escape()
}

/// The join dialog, the presenter's invitation's link given it, as the
/// link is pasted in: once the session has ended, as one presenting
/// joins no other.
pub fn join_scene(scene: &Scene<'_>) -> Result<()> {
    let link = scene.link.lock().ok().and_then(|l| l.clone());
    let Some(link) = link else { return fail("no invitation's link was kept") };
    scene.command("Join…")?;
    scene.session.wait_for(DIALOG)?;
    scene.fill("Invitation", &link)?;
    scene.save_part("live-join", DIALOG)?;
    scene.escape()
}
