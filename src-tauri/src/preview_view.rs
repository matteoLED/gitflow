//! The running app shown in a native child webview laid over the preview panel. Unlike an `<iframe>`,
//! it is a top-level page: its cookies and storage are first-party, so sign-in and CSRF work as in a browser.

use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

use crate::git::errors::{ErrorKind, GitError, GitResult};

const LABEL: &str = "preview";

#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Page zoom, to fit a phone-sized layout into a smaller panel.
    pub zoom: f64,
}

/// Only local dev servers can be previewed.
pub fn local_url(url: &str) -> GitResult<Url> {
    let parsed = Url::parse(url).map_err(|_| GitError::invalid("Invalid preview address."))?;
    let local =
        parsed.scheme() == "http" && matches!(parsed.host_str(), Some("localhost" | "127.0.0.1"));
    local
        .then_some(parsed)
        .ok_or_else(|| GitError::invalid("Only local dev servers can be previewed."))
}

fn err(e: impl std::fmt::Display) -> GitError {
    GitError::new(ErrorKind::Io, format!("Preview window: {e}"))
}

/// Shows `url` at `bounds` (window coordinates), creating the webview or moving/navigating it.
pub fn show(app: &AppHandle, url: &str, bounds: Bounds) -> GitResult<()> {
    let url = local_url(url)?;
    let position = LogicalPosition::new(bounds.x, bounds.y);
    let size = LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0));
    if let Some(view) = app.get_webview(LABEL) {
        if view
            .url()
            .map(|u| u.origin() != url.origin())
            .unwrap_or(true)
        {
            view.navigate(url).map_err(err)?;
        }
        view.set_position(position).map_err(err)?;
        view.set_size(size).map_err(err)?;
        view.set_zoom(bounds.zoom).map_err(err)?;
        return view.show().map_err(err);
    }
    let window = app
        .get_window("main")
        .ok_or_else(|| err("main window not found"))?;
    let view = window
        .add_child(
            WebviewBuilder::new(LABEL, WebviewUrl::External(url)),
            position,
            size,
        )
        .map_err(err)?;
    view.set_zoom(bounds.zoom).map_err(err)
}

/// Hides the preview (kept alive, so coming back is instant and the page keeps its state).
pub fn hide(app: &AppHandle) {
    if let Some(view) = app.get_webview(LABEL) {
        let _ = view.hide();
    }
}

pub fn reload(app: &AppHandle) {
    if let Some(view) = app.get_webview(LABEL) {
        let _ = view.eval("location.reload()");
    }
}

/// The page the user is on inside the preview (route included), for the assistant's context.
pub fn current_url(app: &AppHandle) -> Option<String> {
    app.get_webview(LABEL)
        .and_then(|view| view.url().ok())
        .map(|url| url.to_string())
}

/// Closes it for good, e.g. when the dev server stops.
pub fn close(app: &AppHandle) {
    if let Some(view) = app.get_webview(LABEL) {
        let _ = view.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_local_http_servers_are_previewed() {
        assert!(local_url("http://localhost:5040/").is_ok());
        assert!(local_url("https://evil.example/").is_err());
        assert!(local_url("file:///etc/passwd").is_err());
    }
}
