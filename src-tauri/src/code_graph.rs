//! The repository's code-review-graph (`.code-review-graph/graph.db`, built by the `code-review-graph` CLI):
//! read with fixed read-only SQL through macOS's `sqlite3`, updated and queried through the CLI.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;

use crate::agents::search_path;
use crate::git::errors::{ErrorKind, GitError, GitResult};
use crate::git::validate;

const SQLITE: &str = "/usr/bin/sqlite3";
const CLI: &str = "code-review-graph";

fn err(message: impl std::fmt::Display) -> GitError {
    GitError::new(ErrorKind::Io, format!("Code graph: {message}"))
}

fn db_of(repo: &Path) -> PathBuf {
    repo.join(".code-review-graph/graph.db")
}

fn cli() -> Option<PathBuf> {
    search_path()
        .split(':')
        .map(|dir| Path::new(dir).join(CLI))
        .find(|p| p.is_file())
}

/// Runs one of the fixed queries below; rows come back as JSON objects.
fn query(repo: &Path, sql: &str) -> GitResult<Vec<Value>> {
    let db = db_of(repo);
    if !db.is_file() {
        return Err(GitError::invalid("This repository has no code graph yet."));
    }
    // Read-only and immutable: the CLI keeps the database in WAL mode, which a plain read-only open
    // refuses without write access to its side files. The path is escaped for the URI.
    let path = db
        .to_string_lossy()
        .replace('%', "%25")
        .replace(' ', "%20")
        .replace('?', "%3f")
        .replace('#', "%23");
    let out = Command::new(SQLITE)
        .arg("-json")
        .arg(format!("file:{path}?immutable=1"))
        .arg(sql)
        .output()
        .map_err(err)?;
    if !out.status.success() {
        return Err(err(String::from_utf8_lossy(&out.stderr).trim()));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&text).map_err(err)
}

/// Paths in the graph are absolute: show them relative to the repository.
fn relative(repo: &Path, rows: &mut [Value], fields: &[&str]) {
    let prefix = format!("{}/", repo.to_string_lossy().trim_end_matches('/'));
    for row in rows {
        for field in fields {
            if let Some(Value::String(path)) = row.get_mut(*field)
                && let Some(rest) = path.strip_prefix(&prefix)
            {
                *path = rest.to_string();
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphStatus {
    pub cli: bool,
    pub built: bool,
    pub nodes: u64,
    pub edges: u64,
    pub files: u64,
    pub last_updated: Option<String>,
    pub commit: Option<String>,
    pub branch: Option<String>,
}

pub fn status(repo: &Path) -> GitResult<GraphStatus> {
    let mut status = GraphStatus {
        cli: cli().is_some(),
        built: db_of(repo).is_file(),
        nodes: 0,
        edges: 0,
        files: 0,
        last_updated: None,
        commit: None,
        branch: None,
    };
    if !status.built {
        return Ok(status);
    }
    let counts = query(
        repo,
        "select (select count(*) from nodes) as nodes, (select count(*) from edges) as edges,
           (select count(*) from nodes where kind = 'File') as files",
    )?;
    let count = |k: &str| {
        counts
            .first()
            .and_then(|r| r.get(k))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    status.nodes = count("nodes");
    status.edges = count("edges");
    status.files = count("files");
    for row in query(repo, "select key, value from metadata")? {
        let value = row.get("value").and_then(Value::as_str).map(str::to_string);
        match row.get("key").and_then(Value::as_str) {
            Some("last_updated") => status.last_updated = value,
            Some("git_head_sha") => status.commit = value,
            Some("git_branch") => status.branch = value,
            _ => {}
        }
    }
    Ok(status)
}

/// The riskiest symbols: many callers, no tests, security-relevant code.
pub fn hotspots(repo: &Path) -> GitResult<Vec<Value>> {
    let mut rows = query(
        repo,
        "select n.name, n.kind, n.file_path as file, n.line_start as line, r.risk_score as risk,
           r.caller_count as callers, r.test_coverage as coverage, r.security_relevant as security
         from risk_index r join nodes n on n.id = r.node_id
         where n.is_test = 0 order by r.risk_score desc, r.caller_count desc limit 60",
    )?;
    relative(repo, &mut rows, &["file"]);
    Ok(rows)
}

#[derive(Debug, Serialize)]
pub struct FileMap {
    pub files: Vec<Value>,
    pub links: Vec<Value>,
}

/// Files and how much they call or import each other, for the map.
pub fn file_map(repo: &Path) -> GitResult<FileMap> {
    let mut files = query(
        repo,
        "select file_path as path, sum(kind in ('Function', 'Class')) as symbols, max(is_test) as test
         from nodes group by file_path",
    )?;
    let mut links = query(
        repo,
        "select e.file_path as source, t.file_path as target, count(*) as weight
         from edges e join nodes t on t.qualified_name = e.target_qualified
         where e.kind in ('CALLS', 'IMPORTS_FROM', 'REFERENCES') and t.file_path != e.file_path
         group by 1, 2",
    )?;
    relative(repo, &mut files, &["path"]);
    relative(repo, &mut links, &["source", "target"]);
    Ok(FileMap { files, links })
}

fn run_cli(repo: &Path, args: &[&str]) -> GitResult<String> {
    let cli = cli().ok_or_else(|| {
        GitError::invalid("code-review-graph isn't installed (pipx install code-review-graph).")
    })?;
    let out = Command::new(cli)
        .args(args)
        .arg("--repo")
        .arg(repo)
        .current_dir(repo)
        .env("PATH", search_path())
        .output()
        .map_err(err)?;
    if !out.status.success() {
        return Err(err(String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// What a change touches: changed symbols, test gaps, what to review first (against `base`).
pub fn impact(repo: &Path, base: &str) -> GitResult<Value> {
    let base = validate::revision(base)?;
    let base_arg = format!("--base={base}");
    let text = run_cli(repo, &["detect-changes", &base_arg])?;
    let start = text.find('{').ok_or_else(|| err("no report"))?;
    let mut report: Value = serde_json::from_str(&text[start..]).map_err(err)?;
    for key in ["changed_functions", "review_priorities", "test_gaps"] {
        if let Some(Value::Array(rows)) = report.get_mut(key) {
            relative(repo, rows, &["file_path", "file", "qualified_name"]);
        }
    }
    Ok(report)
}

/// Brings the graph up to date (incremental), or builds it the first time. Writes only its own folder.
pub fn update(repo: &Path) -> GitResult<()> {
    let action = if db_of(repo).is_file() {
        "update"
    } else {
        "build"
    };
    run_cli(repo, &[action]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn paths_become_repository_relative() {
        let mut rows = vec![json!({ "file": "/w/app/src/a.ts", "other": "/w/app/x" })];
        relative(Path::new("/w/app"), &mut rows, &["file"]);
        assert_eq!(rows[0], json!({ "file": "src/a.ts", "other": "/w/app/x" }));
    }

    #[test]
    fn a_base_cannot_be_an_option() {
        assert!(impact(Path::new("/tmp"), "--help").is_err());
    }
}
