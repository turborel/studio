//! The menu bar, built on Tauri's mock runtime on the main thread, as the
//! platforms make menus there alone (RULES.md D30). The program is its own
//! harness, so its one test runs on the main thread.

#![allow(clippy::unwrap_used, clippy::print_stdout, reason = "a test program, whose failures are panics (R-TEST-4)")]

use tauri::test::mock_builder;
use turborel_studio::menu::{self, MENUS};

/// [DESIGN] D30: the menu bar holds each of the menus, in order, the Edit
/// menu after File, and each of Studio's items is a command of the menus.
fn the_menu_bar_holds_every_menu() {
    let app = mock_builder().build(turborel_studio::context()).unwrap();
    let bar = menu::build(app.handle()).unwrap();
    let titles: Vec<String> = bar.items().unwrap().iter().filter_map(|item| item.as_submenu().map(|s| s.text().unwrap())).collect();
    let expected: Vec<String> = ["File", "Edit", "Connection", "View", "Window", "Help"].map(str::to_owned).to_vec();
    assert!(titles.ends_with(&expected), "{titles:?}");
    for (_, items) in MENUS {
        for (id, _) in items.iter().flatten() {
            assert!(menu::is_command(id));
        }
    }
    assert!(!menu::is_command("copy"));
}

fn main() {
    the_menu_bar_holds_every_menu();
    println!("menu: the_menu_bar_holds_every_menu ... ok");
}
