//! A small web browser inside the app (Arc-style): one native webview per tab, laid over the page like
//! the preview. Remote pages get no IPC: capabilities only cover the app's own origin.

use serde::Serialize;
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

use crate::git::errors::{ErrorKind, GitError, GitResult};
use crate::preview_view::{Bounds, round};

const PREFIX: &str = "browser-";
/// WKWebView announces no browser version; some sites then refuse it or serve a degraded page.
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

/// Browser shortcuts keep working while the page has the keyboard: the page has no IPC, so they leave it
/// as a navigation to a made-up scheme that `on_navigation` catches and cancels.
const SHORTCUTS: &str = r#"addEventListener("keydown", (e) => {
  if (!e.metaKey || e.ctrlKey || e.altKey) return;
  const action = { t: "new", l: "address", w: "close", r: "reload", "[": "back", "]": "forward" }[e.key.toLowerCase()];
  if (!action || window.top !== window) return;
  e.preventDefault();
  e.stopPropagation();
  location.href = "gitflow-key://" + action;
}, true);"#;
const ACTIONS: [&str; 6] = ["new", "address", "close", "reload", "back", "forward"];

/// Gives the keyboard back to the app (the address bar), away from the page.
fn focus_app(app: &AppHandle) {
    if let Some(main) = app.get_webview("main") {
        let _ = main.set_focus();
    }
}

/// What the front end hears about a tab.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum BrowserEvent {
    Url {
        id: String,
        url: String,
    },
    Title {
        id: String,
        title: String,
    },
    Loading {
        id: String,
        loading: bool,
    },
    /// A browser shortcut pressed while the page had the keyboard.
    Key {
        id: String,
        action: String,
    },
    /// A link asked for a new window: it becomes a new tab.
    Open {
        url: String,
    },
}

fn err(e: impl std::fmt::Display) -> GitError {
    GitError::new(ErrorKind::Io, format!("Browser: {e}"))
}

/// Web pages only: no `file:`, `javascript:` or app-internal schemes.
pub fn web_url(url: &str) -> GitResult<Url> {
    let parsed = Url::parse(url).map_err(|_| GitError::invalid("Invalid address."))?;
    matches!(parsed.scheme(), "http" | "https")
        .then_some(parsed)
        .ok_or_else(|| GitError::invalid("Only web pages (http, https) can be opened."))
}

fn label(tab: &str) -> GitResult<String> {
    let valid = !tab.is_empty()
        && tab.len() <= 32
        && tab.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    valid
        .then(|| format!("{PREFIX}{tab}"))
        .ok_or_else(|| GitError::invalid("Invalid tab."))
}

fn tab_of(app: &AppHandle, tab: &str) -> Option<tauri::Webview> {
    app.get_webview(&label(tab).ok()?)
}

fn emit(app: &AppHandle, event: BrowserEvent) {
    let _ = app.emit("browser", event);
}

fn create(app: &AppHandle, tab: &str, url: Url, bounds: Bounds) -> GitResult<tauri::Webview> {
    let window = app
        .get_window("main")
        .ok_or_else(|| err("main window not found"))?;
    let (nav_app, load_app, title_app, open_app) =
        (app.clone(), app.clone(), app.clone(), app.clone());
    let (nav_id, load_id, title_id) = (tab.to_string(), tab.to_string(), tab.to_string());
    let builder = WebviewBuilder::new(label(tab)?, WebviewUrl::External(url))
        .user_agent(USER_AGENT)
        .initialization_script(SHORTCUTS)
        .on_navigation(move |url| {
            // Shortcuts pressed inside the page arrive as `gitflow-key://<action>` (see SHORTCUTS).
            if url.scheme() == "gitflow-key" {
                if let Some(action) = url.host_str().filter(|a| ACTIONS.contains(a)) {
                    if matches!(action, "new" | "address") {
                        focus_app(&nav_app);
                    }
                    emit(
                        &nav_app,
                        BrowserEvent::Key {
                            id: nav_id.clone(),
                            action: action.to_string(),
                        },
                    );
                }
                return false;
            }
            // Frames navigate too (ads, about:blank, blob:): only web schemes load, and the address bar
            // follows the main frame alone, through page loads and polling.
            matches!(url.scheme(), "http" | "https" | "about" | "blob" | "data")
        })
        .on_page_load(move |view, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            emit(
                &load_app,
                BrowserEvent::Loading {
                    id: load_id.clone(),
                    loading,
                },
            );
            // A fresh view reports `about:blank` before its first page: only web addresses are kept.
            if let Ok(url) = view.url().map_err(err).and_then(|u| web_url(u.as_str())) {
                emit(
                    &load_app,
                    BrowserEvent::Url {
                        id: load_id.clone(),
                        url: url.to_string(),
                    },
                );
            }
        })
        .on_document_title_changed(move |_, title| {
            emit(
                &title_app,
                BrowserEvent::Title {
                    id: title_id.clone(),
                    title,
                },
            );
        })
        .on_new_window(move |url, _| {
            if matches!(url.scheme(), "http" | "https") {
                emit(
                    &open_app,
                    BrowserEvent::Open {
                        url: url.to_string(),
                    },
                );
            }
            NewWindowResponse::Deny
        });
    window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
        )
        .map_err(err)
}

/// Shows `tab` at `bounds`, creating it on `url` the first time; every other tab is hidden.
pub fn show(app: &AppHandle, tab: &str, url: &str, bounds: Bounds) -> GitResult<()> {
    let name = label(tab)?;
    hide_except(app, Some(&name));
    let view = match app.get_webview(&name) {
        Some(view) => view,
        None => create(app, tab, web_url(url)?, bounds)?,
    };
    view.set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(err)?;
    view.set_size(LogicalSize::new(
        bounds.width.max(1.0),
        bounds.height.max(1.0),
    ))
    .map_err(err)?;
    round(&view, bounds.radius);
    view.show().map_err(err)
}

/// Hides every tab but `keep` (kept alive: pages keep their state).
pub fn hide_except(app: &AppHandle, keep: Option<&str>) {
    for (name, view) in app.webviews() {
        if name.starts_with(PREFIX) && Some(name.as_str()) != keep {
            let _ = view.hide();
        }
    }
}

pub fn close(app: &AppHandle, tab: &str) {
    if let Some(view) = tab_of(app, tab) {
        let _ = view.close();
    }
}

pub fn navigate(app: &AppHandle, tab: &str, url: &str) -> GitResult<()> {
    let url = web_url(url)?;
    tab_of(app, tab)
        .ok_or_else(|| err("tab not open"))?
        .navigate(url)
        .map_err(err)
}

/// `back`, `forward` or `reload`.
pub fn command(app: &AppHandle, tab: &str, action: &str) -> GitResult<()> {
    let script = match action {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err(GitError::invalid("Unknown browser action.")),
    };
    if let Some(view) = tab_of(app, tab) {
        view.eval(script).map_err(err)?;
    }
    Ok(())
}

/// The tab's address right now (single-page apps change it without loading a page).
pub fn current_url(app: &AppHandle, tab: &str) -> Option<String> {
    tab_of(app, tab)?.url().ok().map(|u| u.to_string())
}

pub fn inspect(app: &AppHandle, tab: &str) {
    if let Some(view) = tab_of(app, tab) {
        view.open_devtools();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_pages_open() {
        assert!(web_url("https://linear.app").is_ok());
        assert!(web_url("file:///etc/passwd").is_err());
        assert!(web_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn tab_ids_cannot_reach_other_webviews() {
        assert!(label("../main").is_err());
        assert_eq!(label("t1").unwrap(), "browser-t1");
    }
}
