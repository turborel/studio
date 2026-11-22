//! What the screenshots' scenes (RULES.md D60) do of the explorer's
//! connections: their sections folded or opened, a saved connection
//! connected by its row, an open one made active, the others ended by
//! their menus; and the state every scene begins of.

use crate::error::Result;
use crate::screenshots::scene::{OPEN_ROWS, SAVED_ROWS, Scene, quoted};

impl Scene<'_> {
    /// Opens or closes the explorer's sections of the connections: open,
    /// pinned, saved and recent, those there are.
    pub fn connection_sections(&self, open: bool) -> Result<()> {
        let script = format!(
            "for (const d of document.querySelectorAll('details.explorer-section')) {{ if (['Open', 'Pinned', 'Saved', 'Recent'].includes(d.querySelector('summary')?.textContent.trim())) {{ d.open = {open}; }} }} return true;"
        );
        self.session.script(&script).map(drop)
    }

    /// Whether a saved connection of `name` is listed.
    pub fn saved_exists(&self, name: &str) -> Result<bool> {
        let script = format!("return document.querySelector({}) !== null;", quoted(&format!("{SAVED_ROWS}[aria-label={}]", quoted(name))));
        Ok(self.session.script(&script)?.as_bool().unwrap_or(false))
    }

    /// Connects the saved connection `name`, as a double click on its row does.
    pub fn connect_saved(&self, name: &str) -> Result<()> {
        let script = format!(
            "const r = document.querySelector({}); if (!r) return false; r.dispatchEvent(new MouseEvent('dblclick', {{bubbles: true}})); return true;",
            quoted(&format!("{SAVED_ROWS}[aria-label={}]", quoted(name)))
        );
        self.until(&script, &format!("no saved connection {name} to connect"))
    }

    /// Makes the open connection `name` the active one, as a click on its row does.
    pub fn activate(&self, name: &str) -> Result<()> {
        self.press_button(&format!("{OPEN_ROWS}[aria-label={}]", quoted(name)))
    }

    /// Ends each open connection but `keep`, by Disconnect of its menu, an
    /// open transaction rolled back as it asks: every one, of none kept.
    pub fn disconnect_others(&self, keep: Option<&str>) -> Result<()> {
        let keep = keep.map_or_else(|| "null".to_owned(), quoted);
        let rows = quoted(OPEN_ROWS);
        let script = format!(
            "const back = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Roll Back'); if (back) {{ back.click(); return false; }} const item = [...document.querySelectorAll('[role=menu] [role=menuitem]')].find((b) => b.textContent.trim().startsWith('Disconnect')); if (item) {{ item.click(); return false; }} const rows = [...document.querySelectorAll({rows})].filter((r) => r.getAttribute('aria-label') !== {keep}); if (rows.length === 0) return true; window.studioMenu(rows[0]); return false;"
        );
        self.until(&script, "a connection stayed open")
    }

    /// The state every scene begins of: no menu or dialog open; no
    /// connection open but the demo shop's, it the active one; the
    /// explorer's connections shown; and the catalog's schema drawn.
    pub fn known_state(&self) -> Result<()> {
        for _ in 0..3 {
            self.escape()?;
        }
        self.helpers()?;
        // A notice at the window's top, as of a database recovered, dismissed.
        self.session.script(
            "for (const b of document.querySelectorAll('button')) { if (b.textContent.trim() === 'Dismiss' && b.getBoundingClientRect().top < 80) { b.click(); } } return true;",
        )?;
        self.disconnect_others(Some("Demo shop"))?;
        self.connection_sections(true)?;
        self.activate("Demo shop")?;
        self.wait_text("footer.status-bar", "Demo shop")?;
        self.wait_row("DEMO")
    }

    /// Ends every open connection, as its Disconnect does, so each embedded
    /// database is closed, with its checkpoint, before the window ends.
    pub fn disconnect_all(&self) -> Result<()> {
        for _ in 0..3 {
            self.escape()?;
        }
        self.disconnect_others(None)
    }
}
