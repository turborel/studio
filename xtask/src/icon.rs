//! `icons` (RULES.md D21): Studio's icon set, made by Tauri's CLI from the
//! owner's icon, `artwork/studio-icon.png`, the one source for every
//! platform. The file is already a tile on Apple's grid, so macOS takes it
//! as it is. The CLI's mobile folders are removed: Studio is built for the
//! desktop alone.

use crate::command::{NPM, root, run, say};
use crate::error::Result;

/// The owner's icon, the source of the set.
pub const SOURCE: &str = "artwork/studio-icon.png";
/// Where Tauri's icon set goes.
const ICONS: &str = "src-tauri/icons";
/// The folders of mobile icons the CLI makes too.
const MOBILE: [&str; 2] = ["android", "ios"];

/// Makes Tauri's icon set of the source.
pub fn icons() -> Result<()> {
    run(NPM, &["exec", "--", "tauri", "icon", SOURCE, "--output", ICONS], &[])?;
    for folder in MOBILE {
        let made = root().join(ICONS).join(folder);
        if made.is_dir() {
            std::fs::remove_dir_all(made)?;
        }
    }
    say(&format!("icons: {ICONS} made of {SOURCE}"));
    Ok(())
}
