//! Tauri's build step, with the application's own commands named so each
//! is a permission a window must be granted (RULES.md R-SEC-5): no command
//! is reachable from a webview its capability does not list.

/// Every command the application defines, as `src/commands.rs` registers
/// them and `capabilities/main.json` grants them; the checks tool holds the
/// three lists equal.
const COMMANDS: [&str; 1] = ["app_info"];

fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&COMMANDS);
    #[allow(clippy::expect_used, reason = "a build script reports its failure by panicking, which cargo shows")]
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("Tauri's build step");
}
