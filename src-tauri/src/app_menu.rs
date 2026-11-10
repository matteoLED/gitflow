//! The macOS menu bar: Tauri's default one (Edit keeps copy/paste working in the webview), plus the app's
//! own entries. Shortcuts declared here are matched by macOS on the character typed, whatever the keyboard
//! layout: ⌘/ is ⇧: on a French keyboard, which a keydown listener in the page doesn't reliably see.

use tauri::menu::{HELP_SUBMENU_ID, Menu, MenuItem, PredefinedMenuItem};
use tauri::{App, AppHandle, Emitter, Wry};

/// Sent to the page as the `menu` event's payload.
const RELOAD: &str = "reload";
const SHORTCUTS: &str = "shortcuts";

pub fn install(app: &App) -> tauri::Result<()> {
    let handle = app.handle();
    let menu = Menu::default(handle)?;
    for item in menu.items()? {
        let Some(submenu) = item.as_submenu() else {
            continue;
        };
        if submenu.text()? == "View" {
            submenu.prepend_items(&[
                &MenuItem::with_id(handle, RELOAD, "Reload", true, Some("CmdOrCtrl+R"))?,
                &PredefinedMenuItem::separator(handle)?,
            ])?;
        } else if submenu.id() == HELP_SUBMENU_ID {
            submenu.append(&MenuItem::with_id(
                handle,
                SHORTCUTS,
                "Keyboard Shortcuts",
                true,
                Some("CmdOrCtrl+/"),
            )?)?;
        }
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app: &AppHandle<Wry>, event| {
        let id = event.id().as_ref();
        if id == RELOAD || id == SHORTCUTS {
            let _ = app.emit("menu", id);
        }
    });
    Ok(())
}
