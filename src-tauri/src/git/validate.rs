//! Validation for every value coming from the UI before it reaches a git argument vector.

use std::path::{Component, Path, PathBuf};

use super::errors::{ErrorKind, GitError, GitResult};

fn has_control_chars(value: &str) -> bool {
    value.chars().any(char::is_control)
}

/// Absolute path to an existing directory.
pub fn repo_path(path: &str) -> GitResult<PathBuf> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || !path.is_dir() {
        return Err(GitError::new(
            ErrorKind::NotARepository,
            "This folder doesn't exist or isn't accessible.",
        ));
    }
    Ok(path)
}

/// Full or abbreviated object id (SHA-1 or SHA-256).
pub fn object_id(hash: &str) -> GitResult<&str> {
    let valid = (4..=64).contains(&hash.len()) && hash.bytes().all(|b| b.is_ascii_hexdigit());
    valid
        .then_some(hash)
        .ok_or_else(|| GitError::invalid("Invalid commit hash."))
}

/// Existing ref or revision name. Never starts with `-`, so it can't be read as an option.
pub fn revision(name: &str) -> GitResult<&str> {
    let valid =
        !name.is_empty() && name.len() <= 255 && !name.starts_with('-') && !has_control_chars(name);
    valid
        .then_some(name)
        .ok_or_else(|| GitError::invalid("Invalid branch or revision name."))
}

/// Repository-relative path that cannot escape the work tree.
pub fn relative_path(path: &str) -> GitResult<&str> {
    let escapes = Path::new(path)
        .components()
        .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir));
    let valid = !path.is_empty() && !escapes && !has_control_chars(path);
    valid
        .then_some(path)
        .ok_or_else(|| GitError::invalid(format!("Invalid file path: {path}")))
}

pub fn relative_paths(paths: &[String]) -> GitResult<Vec<&str>> {
    if paths.is_empty() {
        return Err(GitError::invalid("No files selected."));
    }
    paths.iter().map(|p| relative_path(p)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_repo_paths() {
        assert!(repo_path("some/dir").is_err());
    }

    #[test]
    fn accepts_full_sha256() {
        assert!(object_id(&"a".repeat(64)).is_ok());
    }

    #[test]
    fn rejects_non_hex_hashes() {
        assert!(object_id("HEAD; rm").is_err());
    }

    #[test]
    fn rejects_option_like_revisions() {
        assert!(revision("--output=/tmp/x").is_err());
    }

    #[test]
    fn accepts_slashed_branch_names() {
        assert!(revision("feature/été").is_ok());
    }

    #[test]
    fn rejects_paths_escaping_the_repo() {
        assert!(relative_path("../secrets").is_err());
    }

    #[test]
    fn rejects_absolute_paths() {
        assert!(relative_path("/etc/passwd").is_err());
    }

    #[test]
    fn accepts_paths_with_spaces() {
        assert!(relative_path("docs/my notes.md").is_ok());
    }
}
