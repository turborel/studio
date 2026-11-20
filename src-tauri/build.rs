//! Tauri's build step, with the application's own commands named so each
//! is a permission a window must be granted (RULES.md R-SEC-5): no command
//! is reachable from a webview its capability does not list.
//!
//! On Windows, the application's manifest, which asks for Common Controls
//! 6, is linked into every program of the package, the tests among them:
//! Tauri links it into the application alone, and a test program without
//! it cannot start (STATUS_ENTRYPOINT_NOT_FOUND).

/// Every command the application defines, as `src/commands.rs` registers
/// them and `capabilities/main.json` grants them; the checks tool holds the
/// three lists equal.
const COMMANDS: [&str; 1] = ["app_info"];

/// The manifest every Windows program of the package is linked with.
const WINDOWS_MANIFEST: &str = "windows-app-manifest.xml";

fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&COMMANDS);
    let mut attributes = tauri_build::Attributes::new().app_manifest(manifest);
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|env| env == "msvc");
    if windows_msvc {
        attributes = attributes.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(WINDOWS_MANIFEST);
        #[allow(clippy::print_stdout, reason = "a build script speaks to cargo by its standard output")]
        {
            println!("cargo:rerun-if-changed={WINDOWS_MANIFEST}");
            println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
            println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", path.display());
        }
    }
    #[allow(clippy::expect_used, reason = "a build script reports its failure by panicking, which cargo shows")]
    tauri_build::try_build(attributes).expect("Tauri's build step");
}
