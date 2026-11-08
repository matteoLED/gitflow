//! The user's Git identity (`user.name` / `user.email` in ~/.gitconfig), shown and edited from Settings.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::errors::{GitError, GitResult};
use super::runner::{RunOptions, git_with};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// Which config file to use: the user's global one, or an explicit file (tests).
enum Scope<'a> {
    Global,
    #[cfg_attr(not(test), allow(dead_code))] // only tests target a scratch file
    File(&'a Path),
}

impl Scope<'_> {
    fn args(&self) -> Vec<String> {
        match self {
            Scope::Global => vec!["--global".into()],
            Scope::File(path) => vec!["--file".into(), path.to_string_lossy().into_owned()],
        }
    }
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn config(scope: &Scope, rest: &[&str], opts: &RunOptions) -> GitResult<Vec<u8>> {
    let scope_args = scope.args();
    let mut args = vec!["config"];
    args.extend(scope_args.iter().map(String::as_str));
    args.extend(rest);
    git_with(&home(), &args, opts)
}

/// `git config --get` exits 1 for an unset key: that's "no value", not an error.
fn read_key(scope: &Scope, key: &str) -> GitResult<Option<String>> {
    let out = config(
        scope,
        &["--get", key],
        &RunOptions {
            ok_codes: &[1],
            ..RunOptions::default()
        },
    )?;
    let value = String::from_utf8_lossy(&out).trim().to_string();
    Ok((!value.is_empty()).then_some(value))
}

fn read(scope: &Scope) -> GitResult<GitIdentity> {
    Ok(GitIdentity {
        name: read_key(scope, "user.name")?,
        email: read_key(scope, "user.email")?,
    })
}

fn checked(value: &str, what: &str) -> GitResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 200 || value.chars().any(char::is_control) {
        return Err(GitError::invalid(format!("Enter a valid {what}.")));
    }
    Ok(value.to_string())
}

fn write(scope: &Scope, name: &str, email: &str) -> GitResult<GitIdentity> {
    let name = checked(name, "name")?;
    let email = checked(email, "email")?;
    if !email.contains('@') || email.contains(['<', '>']) {
        return Err(GitError::invalid("Enter a valid email address."));
    }
    config(scope, &["user.name", &name], &RunOptions::default())?;
    config(scope, &["user.email", &email], &RunOptions::default())?;
    read(scope)
}

pub fn read_identity() -> GitResult<GitIdentity> {
    read(&Scope::Global)
}

pub fn write_identity(name: &str, email: &str) -> GitResult<GitIdentity> {
    write(&Scope::Global, name, email)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_round_trips_through_the_config_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("gitconfig");
        write(&Scope::File(&file), " Ana Lima ", "ana@x.io").unwrap();
        let identity = read(&Scope::File(&file)).unwrap();
        assert_eq!(
            (identity.name.as_deref(), identity.email.as_deref()),
            (Some("Ana Lima"), Some("ana@x.io"))
        );
    }

    #[test]
    fn invalid_emails_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        assert!(
            write(
                &Scope::File(&dir.path().join("gitconfig")),
                "Ana",
                "not-an-email"
            )
            .is_err()
        );
    }

    #[test]
    fn unset_keys_read_as_none() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("gitconfig"), "").unwrap();
        assert_eq!(
            read(&Scope::File(&dir.path().join("gitconfig")))
                .unwrap()
                .name,
            None
        );
    }
}
