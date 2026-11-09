//! Claude Code sub-agents: Markdown files with a front matter, in `~/.claude/agents/` (every project)
//! or `<repo>/.claude/agents/` (this project). Listed, created, edited and deleted from the app.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::git::errors::{ErrorKind, GitError, GitResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    User,
    Project,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub name: String,
    pub description: String,
    /// `opus`, `sonnet`, `haiku`, `inherit`… empty when the file doesn't say.
    #[serde(default)]
    pub model: String,
    /// Comma-separated tool names; empty means every tool.
    #[serde(default)]
    pub tools: String,
    /// The agent's system prompt (the file's body).
    pub prompt: String,
    pub scope: Scope,
}

fn io(e: impl std::fmt::Display) -> GitError {
    GitError::new(ErrorKind::Io, format!("Agents: {e}"))
}

fn dir_of(scope: Scope, repo: &Path) -> GitResult<PathBuf> {
    match scope {
        Scope::Project => Ok(repo.join(".claude/agents")),
        Scope::User => std::env::var_os("HOME")
            .map(|h| Path::new(&h).join(".claude/agents"))
            .ok_or_else(|| GitError::invalid("HOME is not set.")),
    }
}

/// Lowercase letters, digits and dashes: the name is also the file name.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// `key: value` lines between `---` fences, then the body. Values may be quoted; lists stay as written.
fn parse(text: &str, scope: Scope, fallback: &str) -> AgentDefinition {
    let mut def = AgentDefinition {
        name: fallback.to_string(),
        description: String::new(),
        model: String::new(),
        tools: String::new(),
        prompt: text.trim().to_string(),
        scope,
    };
    let Some(rest) = text.strip_prefix("---") else {
        return def;
    };
    let Some(end) = rest.find("\n---") else {
        return def;
    };
    for line in rest[..end].lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        match key.trim() {
            "name" if !value.is_empty() => def.name = value,
            "description" => def.description = value,
            "model" => def.model = value,
            "tools" | "allowed-tools" => def.tools = value,
            _ => {}
        }
    }
    def.prompt = rest[end + 4..].trim().to_string();
    def
}

fn render(def: &AgentDefinition) -> String {
    let one_line = |s: &str| s.replace(['\n', '\r'], " ");
    let mut text = format!(
        "---\nname: {}\ndescription: {}\n",
        def.name,
        one_line(&def.description)
    );
    if !def.model.trim().is_empty() {
        text.push_str(&format!("model: {}\n", one_line(def.model.trim())));
    }
    if !def.tools.trim().is_empty() {
        text.push_str(&format!("tools: {}\n", one_line(def.tools.trim())));
    }
    text.push_str("---\n\n");
    text.push_str(def.prompt.trim());
    text.push('\n');
    text
}

/// This project's agents, then the user's (a project agent overrides a user one of the same name).
pub fn list(repo: &Path) -> GitResult<Vec<AgentDefinition>> {
    let mut all = Vec::new();
    for scope in [Scope::Project, Scope::User] {
        let Ok(entries) = fs::read_dir(dir_of(scope, repo)?) else {
            continue;
        };
        let mut defs: Vec<_> = entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "md"))
            .filter_map(|p| {
                let stem = p.file_stem()?.to_string_lossy().into_owned();
                Some(parse(&fs::read_to_string(&p).ok()?, scope, &stem))
            })
            .collect();
        defs.sort_by(|a, b| a.name.cmp(&b.name));
        all.extend(defs);
    }
    Ok(all)
}

/// Writes the agent's file; `previous` is its old name when it was renamed (that file goes away).
pub fn save(repo: &Path, def: &AgentDefinition, previous: Option<&str>) -> GitResult<()> {
    if !valid_name(&def.name) {
        return Err(GitError::invalid(
            "An agent name uses lowercase letters, digits and dashes.",
        ));
    }
    if def.description.trim().is_empty() {
        return Err(GitError::invalid(
            "Describe when Claude should use this agent.",
        ));
    }
    let dir = dir_of(def.scope, repo)?;
    fs::create_dir_all(&dir).map_err(io)?;
    let path = dir.join(format!("{}.md", def.name));
    let renamed = previous.filter(|p| *p != def.name);
    if renamed.is_some() && path.exists() {
        return Err(GitError::invalid("An agent with this name already exists."));
    }
    fs::write(&path, render(def)).map_err(io)?;
    if let Some(old) = renamed.filter(|p| valid_name(p)) {
        let _ = fs::remove_file(dir.join(format!("{old}.md")));
    }
    Ok(())
}

pub fn delete(repo: &Path, scope: Scope, name: &str) -> GitResult<()> {
    if !valid_name(name) {
        return Err(GitError::invalid("Invalid agent name."));
    }
    fs::remove_file(dir_of(scope, repo)?.join(format!("{name}.md"))).map_err(io)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = "---\nname: reviewer\nmodel: opus\ndescription: Code review.\nallowed-tools: Read, Grep\n---\nReview.\n";

    #[test]
    fn front_matter_and_body_are_read() {
        let def = parse(FILE, Scope::User, "x");
        assert_eq!(
            (
                def.name.as_str(),
                def.model.as_str(),
                def.tools.as_str(),
                def.prompt.as_str()
            ),
            ("reviewer", "opus", "Read, Grep", "Review.")
        );
    }

    #[test]
    fn saved_agents_read_back_the_same() {
        let repo = tempfile::tempdir().unwrap();
        let def = AgentDefinition {
            name: "tester".into(),
            description: "Writes tests.\nWith edge cases.".into(),
            model: "sonnet".into(),
            tools: String::new(),
            prompt: "Write tests.".into(),
            scope: Scope::Project,
        };
        save(repo.path(), &def, None).unwrap();
        let back = &list(repo.path()).unwrap()[0];
        assert_eq!(
            (back.description.as_str(), back.prompt.as_str()),
            ("Writes tests. With edge cases.", "Write tests.")
        );
    }

    #[test]
    fn names_cannot_leave_the_folder() {
        assert!(delete(Path::new("/tmp"), Scope::Project, "../../etc/passwd").is_err());
    }
}
