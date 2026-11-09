//! Images the user pastes or drops into an agent conversation, saved under the app's data folder.
//! Agents only ever receive paths from here: the UI can't make them read an arbitrary file.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::git::errors::{GitError, GitResult};

static DIR: OnceLock<PathBuf> = OnceLock::new();
const MAX_BYTES: usize = 10 * 1024 * 1024;
const EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

pub fn init(dir: PathBuf) {
    let _ = DIR.set(dir);
}

fn dir() -> GitResult<&'static PathBuf> {
    DIR.get()
        .ok_or_else(|| GitError::invalid("Attachments aren't ready."))
}

/// Saves a base64 image and returns its path.
pub fn save(data: &str, extension: &str) -> GitResult<String> {
    let extension = extension.to_ascii_lowercase();
    if !EXTENSIONS.contains(&extension.as_str()) {
        return Err(GitError::invalid(
            "Only PNG, JPEG, GIF and WebP images can be attached.",
        ));
    }
    let bytes =
        decode_base64(data).ok_or_else(|| GitError::invalid("That image couldn't be read."))?;
    if bytes.len() > MAX_BYTES {
        return Err(GitError::invalid("Images are limited to 10 MB."));
    }
    let dir = dir()?;
    std::fs::create_dir_all(dir)
        .map_err(|e| GitError::invalid(format!("Couldn't save the image: {e}")))?;
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let path = dir.join(format!(
        "{stamp:x}-{}.{extension}",
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&path, bytes)
        .map_err(|e| GitError::invalid(format!("Couldn't save the image: {e}")))?;
    Ok(path.to_string_lossy().into_owned())
}

/// True only for a file saved by `save` (no `..` tricks: the path is resolved first).
pub fn is_attachment(path: &str) -> bool {
    let (Ok(dir), Ok(file)) = (dir().and_then(|d| canonical(d)), canonical(Path::new(path))) else {
        return false;
    };
    file.parent() == Some(dir.as_path()) && file.is_file()
}

fn canonical(path: &Path) -> GitResult<PathBuf> {
    path.canonicalize()
        .map_err(|_| GitError::invalid("Unknown attachment."))
}

fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let clean: Vec<u8> = text
        .bytes()
        .filter(|c| !c.is_ascii_whitespace() && *c != b'=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            n |= u32::from(value(c)?) << (18 - 6 * i);
        }
        let bytes = n.to_be_bytes();
        out.extend_from_slice(&bytes[1..chunk.len()]);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_standard_base64() {
        assert_eq!(decode_base64("TWFu").unwrap(), b"Man");
        assert_eq!(decode_base64("TWE=").unwrap(), b"Ma");
        assert_eq!(decode_base64("TQ==").unwrap(), b"M");
        assert!(decode_base64("a$b").is_none());
    }

    #[test]
    fn only_saved_images_count_as_attachments() {
        assert!(!is_attachment("/etc/passwd"));
    }
}
