//! AI agents through the user's own CLIs and subscriptions (Claude Code, Codex): the app never sees a
//! token. Runs are read-only: Claude runs in plan mode, Codex in its read-only sandbox.

pub mod definitions;
pub mod sessions;
pub mod steps;
pub mod usage;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::git::errors::{ErrorKind, GitError, GitResult};
use crate::git::validate;
use steps::{AgentStep, StepKind, Usage, from_claude, from_codex, step, usage_of};

const RUN_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const EXTRA_PATH: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Claude,
    Codex,
}

impl AgentKind {
    fn binary(self) -> &'static str {
        match self {
            AgentKind::Claude => "claude",
            AgentKind::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub kind: AgentKind,
    pub installed: bool,
    pub version: Option<String>,
}

/// Apps started from the Finder get a minimal PATH: also look where Homebrew and npm install CLIs.
pub fn search_path() -> String {
    let home_bins = std::env::var("HOME")
        .map(|h| {
            [
                format!("{h}/.local/bin"),
                format!("{h}/.npm-global/bin"),
                format!("{h}/.bun/bin"),
            ]
        })
        .unwrap_or_default();
    let mut dirs: Vec<String> = std::env::var("PATH")
        .map(|p| p.split(':').map(str::to_string).collect())
        .unwrap_or_default();
    dirs.extend(EXTRA_PATH.map(str::to_string));
    dirs.extend(home_bins);
    dirs.join(":")
}

fn find(kind: AgentKind) -> Option<PathBuf> {
    search_path()
        .split(':')
        .map(|dir| Path::new(dir).join(kind.binary()))
        .find(|candidate| candidate.is_file())
}

pub fn detect() -> Vec<AgentInfo> {
    [AgentKind::Claude, AgentKind::Codex]
        .into_iter()
        .map(|kind| {
            let path = find(kind);
            let version = path.as_ref().and_then(|p| {
                let out = Command::new(p)
                    .arg("--version")
                    .env("PATH", search_path())
                    .output()
                    .ok()?;
                Some(
                    String::from_utf8_lossy(&out.stdout)
                        .lines()
                        .next()?
                        .trim()
                        .to_string(),
                )
            });
            AgentInfo {
                kind,
                installed: path.is_some(),
                version,
            }
        })
        .collect()
}

/// What the agent is asked to do. Prompts are built here, never from raw UI strings alone.
#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AgentTask {
    ReviewPullRequest {
        number: u32,
        base: String,
        head: String,
    },
    /// Same review, as strict JSON line comments the user edits before posting them on GitHub.
    AiReviewPullRequest {
        number: u32,
        base: String,
        head: String,
    },
    ExplainCommit {
        hash: String,
    },
    CommitMessage,
    /// Groups the pending changes into commits, as strict JSON the user edits before committing.
    SplitCommits,
    Custom {
        prompt: String,
    },
}

/// How much the agent may do, as in Claude Code's own mode picker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    /// Reads and answers; anything that writes is refused (Claude plan mode, Codex read-only sandbox).
    Plan,
    /// Claude decides what is safe to run; Codex may write in the workspace.
    Auto,
    /// File edits are accepted; other actions follow the user's own permission rules.
    AcceptEdits,
    /// Everything is allowed. Only for trusted work.
    Bypass,
}

const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// Mode, model and effort chosen in the composer.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSettings {
    pub mode: Mode,
    pub model: Option<String>,
    pub effort: Option<String>,
    /// Images pasted into the message (paths from `attachments::save` only).
    #[serde(default)]
    pub images: Vec<String>,
    /// Run in this agent worktree of the repository instead of the repository itself.
    #[serde(default)]
    pub worktree: Option<String>,
}

impl Default for RunSettings {
    fn default() -> Self {
        RunSettings {
            mode: Mode::Plan,
            model: None,
            effort: None,
            images: Vec::new(),
            worktree: None,
        }
    }
}

impl RunSettings {
    fn validate(&self) -> GitResult<()> {
        let model_ok = self.model.as_deref().is_none_or(|m| {
            !m.is_empty()
                && m.len() <= 64
                && m.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-._[]".contains(c))
        });
        let effort_ok = self.effort.as_deref().is_none_or(|e| EFFORTS.contains(&e));
        (model_ok && effort_ok)
            .then_some(())
            .ok_or_else(|| GitError::invalid("Invalid model or effort."))
    }
}

const READ_ONLY: &str = "Do not modify, create or delete any file; only read and report.";

fn language(locale: &str) -> &'static str {
    if locale == "fr" {
        "Answer in French."
    } else {
        "Answer in English."
    }
}

fn build_prompt(task: &AgentTask, locale: &str, mode: Mode) -> GitResult<String> {
    let lang = language(locale);
    Ok(match task {
        AgentTask::ReviewPullRequest { number, base, head } => {
            let (base, head) = (validate::object_id(base)?, validate::object_id(head)?);
            format!(
                "Review pull request #{number} of this repository. Its full diff is `git diff {base}..{head}` \
                 and its commits are `git log {base}..{head}`; read the changed files for context when needed.\n\
                 Report in Markdown: a 2-3 line summary, then the issues ordered by severity (bugs, security, \
                 regressions, missing tests), each with `path:line` and a concrete fix, then minor suggestions. \
                 Skip praise. {READ_ONLY} {lang}"
            )
        }
        AgentTask::AiReviewPullRequest { number, base, head } => {
            let (base, head) = (validate::object_id(base)?, validate::object_id(head)?);
            format!(
                "Review pull request #{number} of this repository. Its full diff is `git diff {base}...{head}`; \
                 read the changed files for context when needed. Report only real problems: bugs, security, \
                 regressions, risky changes, missing tests, and questions worth asking. Skip praise and style \
                 nits a linter would catch.\n\
                 Output ONLY one JSON object, no prose and no code fence, with exactly this shape:\n\
                 {{\"summary\": string, \"comments\": [{{\"path\": string, \"line\": integer, \
                 \"side\": \"RIGHT\" | \"LEFT\", \"severity\": \"bug\" | \"risk\" | \"nit\" | \"question\", \
                 \"body\": string}}]}}\n\
                 `summary` is 2-3 lines of Markdown. `path` is relative to the repository root. `line` must be a \
                 line shown in that diff: its number in the new file with side RIGHT (added or unchanged lines), \
                 or in the old file with side LEFT (removed lines). `body` is Markdown with a concrete fix. \
                 At most 30 comments. {READ_ONLY} {lang}"
            )
        }
        AgentTask::ExplainCommit { hash } => {
            let hash = validate::object_id(hash)?;
            format!(
                "Explain commit {hash} of this repository (`git show {hash}`): what changed, the likely reason, \
                 and any risk worth a second look, with `path:line` references. Be concise. {READ_ONLY} {lang}"
            )
        }
        AgentTask::CommitMessage => format!(
            "Write a commit message for the staged changes (`git diff --cached`). Conventional Commits, English, \
             imperative mood, subject under 72 characters, optional short body explaining why. Output only the \
             message: no code fences, no commentary. {READ_ONLY}"
        ),
        AgentTask::SplitCommits => format!(
            "Group the pending changes of this repository (below) into a few focused commits, in the order they \
             should be made. Output ONLY a JSON array, no prose and no code fence, with this shape:\n\
             [{{\"message\": string, \"files\": [string]}}]\n\
             `message` is a Conventional Commits message in English (imperative subject under 72 characters). \
             `files` holds paths from the changed-paths list only; a path appears in at most one commit. \
             {READ_ONLY}"
        ),
        AgentTask::Custom { prompt } => {
            let prompt = prompt.trim();
            if prompt.is_empty() || prompt.len() > 20_000 {
                return Err(GitError::invalid(
                    "Write a request for the agent (20,000 characters at most).",
                ));
            }
            // The user's own words, sent as typed: the agent answers in the language they wrote in.
            // Reviews and explanations always read; a free request may act when the mode allows it.
            if mode == Mode::Plan {
                format!("{prompt}\n\n{READ_ONLY}")
            } else {
                prompt.to_string()
            }
        }
    })
}

/// The CLI invocation for a run. The prompt goes through stdin, so it can never be parsed as a flag.
fn command(
    kind: AgentKind,
    program: &Path,
    repo: &Path,
    settings: &RunSettings,
    resume: Option<&str>,
) -> Command {
    let mut cmd = Command::new(program);
    cmd.current_dir(repo).env("PATH", search_path());
    match kind {
        AgentKind::Claude => {
            let mode = match settings.mode {
                Mode::Plan => "plan",
                Mode::Auto => "auto",
                Mode::AcceptEdits => "acceptEdits",
                Mode::Bypass => "bypassPermissions",
            };
            cmd.args([
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--permission-mode",
                mode,
            ]);
            if settings.mode == Mode::Plan {
                // Belt and braces: plan mode already refuses writes, even when the user's settings allow them.
                cmd.args([
                    "--disallowedTools",
                    "Edit",
                    "Write",
                    "MultiEdit",
                    "NotebookEdit",
                ]);
            }
            if let Some(model) = &settings.model {
                cmd.args(["--model", model]);
            }
            if let Some(effort) = &settings.effort {
                cmd.args(["--effort", effort]);
            }
            if let Some(id) = resume {
                cmd.args(["--resume", id]);
            }
        }
        AgentKind::Codex => {
            let sandbox = match settings.mode {
                Mode::Plan => "read-only",
                Mode::Auto | Mode::AcceptEdits => "workspace-write",
                Mode::Bypass => "danger-full-access",
            };
            cmd.args([
                "exec",
                "--json",
                "--sandbox",
                sandbox,
                "--skip-git-repo-check",
            ]);
            if let Some(model) = &settings.model {
                cmd.args(["--model", model]);
            }
            if let Some(effort) = &settings.effort {
                let effort = if effort == "xhigh" || effort == "max" {
                    "high"
                } else {
                    effort.as_str()
                };
                cmd.args(["-c", &format!("model_reasoning_effort={effort}")]);
            }
            // `--image=path`: the separate form would let clap swallow the trailing `-` (prompt on stdin).
            for image in &settings.images {
                cmd.arg(format!("--image={image}"));
            }
            if let Some(id) = resume {
                cmd.args(["resume", id]);
            }
            cmd.arg("-");
        }
    }
    cmd
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum RunEvent {
    Step {
        run_id: String,
        step: AgentStep,
    },
    /// The agent's own conversation id, needed to continue the conversation later.
    Session {
        run_id: String,
        session_id: String,
    },
    Finished {
        run_id: String,
        status: RunStatus,
    },
    /// Context fill and cost so far; unknown fields are null and keep their previous value in the UI.
    Usage {
        run_id: String,
        usage: Usage,
    },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Done,
    Failed,
    Cancelled,
}

type Registry = Mutex<HashMap<String, Arc<Mutex<Child>>>>;

fn running() -> &'static Registry {
    static RUNNING: OnceLock<Registry> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

fn emit(app: &AppHandle, event: RunEvent) {
    let _ = app.emit("agent-run", event);
}

/// Starts a run and streams its steps as `agent-run` events; returns the run id immediately.
/// Unique across launches: finished runs are kept by the UI, so a counter restarting at 1 would make a new
/// run land in an old one (its steps appended to it, its "done" status inherited).
fn new_run_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let launch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    format!("run-{launch:x}-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

pub fn start(
    app: AppHandle,
    repo: &Path,
    kind: AgentKind,
    task: &AgentTask,
    locale: &str,
    resume: Option<&str>,
    settings: &RunSettings,
) -> GitResult<String> {
    settings.validate()?;
    if settings.images.len() > 8
        || !settings
            .images
            .iter()
            .all(|p| crate::attachments::is_attachment(p))
    {
        return Err(GitError::invalid(
            "Only images attached in the app can be sent to an agent.",
        ));
    }
    let mut prompt = build_prompt(task, locale, settings.mode)?;
    if matches!(task, AgentTask::SplitCommits) {
        prompt.push_str("\n\n");
        prompt.push_str(&crate::git::staging::change_summary(repo)?);
    }
    // Claude Code reads images from disk with its Read tool; Codex also gets them through --image.
    if !settings.images.is_empty() {
        prompt.push_str("\n\nImages attached by the user (look at them first):");
        for image in &settings.images {
            prompt.push_str(&format!("\n- {image}"));
        }
    }
    let program = find(kind).ok_or_else(|| {
        GitError::new(
            ErrorKind::GitNotFound,
            format!("`{}` isn't installed or not on PATH.", kind.binary()),
        )
    })?;
    if let Some(id) = resume {
        let valid = !id.is_empty()
            && id.len() <= 64
            && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if !valid {
            return Err(GitError::invalid("Invalid conversation id."));
        }
    }
    // An isolated run works in its own worktree, which must be one the app made for this repository.
    let cwd = match &settings.worktree {
        Some(path) => crate::git::worktrees::checked_path(repo, path)?,
        None => repo.to_path_buf(),
    };
    let mut cmd = command(kind, &program, &cwd, settings, resume);
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            GitError::new(
                ErrorKind::Io,
                format!("Couldn't start {}: {err}", kind.binary()),
            )
        })?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes()); // dropped here: EOF tells the CLI the prompt is complete
    }
    let run_id = new_run_id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    if let Ok(mut map) = running().lock() {
        map.insert(run_id.clone(), Arc::clone(&child));
    }
    emit(
        &app,
        RunEvent::Step {
            run_id: run_id.clone(),
            step: step(
                StepKind::Prompt,
                prompt.lines().next().unwrap_or_default(),
                Some(prompt.clone()),
            ),
        },
    );

    let reader = {
        let (app, run_id) = (app.clone(), run_id.clone());
        thread::spawn(move || {
            let Some(stdout) = stdout else { return };
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(event) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                // Claude's init event and Codex's thread.started carry the conversation id.
                let session = event
                    .get("session_id")
                    .or_else(|| event.get("thread_id"))
                    .and_then(Value::as_str);
                if let Some(session_id) = session {
                    emit(
                        &app,
                        RunEvent::Session {
                            run_id: run_id.clone(),
                            session_id: session_id.to_string(),
                        },
                    );
                }
                if let Some(usage) = usage_of(&event) {
                    emit(
                        &app,
                        RunEvent::Usage {
                            run_id: run_id.clone(),
                            usage,
                        },
                    );
                }
                let parsed = match kind {
                    AgentKind::Claude => from_claude(&event),
                    AgentKind::Codex => from_codex(&event),
                };
                for step in parsed {
                    emit(
                        &app,
                        RunEvent::Step {
                            run_id: run_id.clone(),
                            step,
                        },
                    );
                }
            }
        })
    };
    let stderr_tail = thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut pipe) = stderr {
            let _ = pipe.read_to_string(&mut text);
        }
        steps::clip(text.trim(), 2_000)
    });

    let id = run_id.clone();
    thread::spawn(move || {
        let started = Instant::now();
        let status = loop {
            let polled = child.lock().map(|mut c| c.try_wait());
            match polled {
                Ok(Ok(Some(exit))) => break Some(exit),
                Ok(Ok(None)) if started.elapsed() < RUN_TIMEOUT => {
                    thread::sleep(Duration::from_millis(200))
                }
                _ => {
                    if let Ok(mut c) = child.lock() {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                    break None;
                }
            }
        };
        let _ = reader.join();
        let stderr = stderr_tail.join().unwrap_or_default();
        let cancelled = running()
            .lock()
            .map(|mut m| m.remove(&id).is_none())
            .unwrap_or(false);
        let status = match status {
            _ if cancelled => RunStatus::Cancelled,
            Some(exit) if exit.success() => RunStatus::Done,
            _ => {
                let detail = (!stderr.is_empty()).then_some(stderr);
                emit(
                    &app,
                    RunEvent::Step {
                        run_id: id.clone(),
                        step: step(StepKind::Error, "The agent stopped with an error", detail),
                    },
                );
                RunStatus::Failed
            }
        };
        emit(&app, RunEvent::Finished { run_id: id, status });
    });
    Ok(run_id)
}

/// Stops a run; its waiter thread then reports it as cancelled.
pub fn cancel(run_id: &str) {
    let child = running().lock().ok().and_then(|mut m| m.remove(run_id));
    if let Some(mut c) = child.as_ref().and_then(|c| c.lock().ok()) {
        let _ = c.kill();
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn run_ids_never_repeat() {
        assert_ne!(new_run_id(), new_run_id());
    }

    use super::*;

    #[test]
    fn prompts_reject_revisions_that_are_not_object_ids() {
        let task = AgentTask::ExplainCommit {
            hash: "HEAD; rm -rf /".into(),
        };
        assert!(build_prompt(&task, "en", Mode::Plan).is_err());
    }

    #[test]
    fn ai_reviews_ask_for_json_on_the_three_dot_diff() {
        let task = AgentTask::AiReviewPullRequest {
            number: 7,
            base: "a".repeat(40),
            head: "b".repeat(40),
        };
        let prompt = build_prompt(&task, "en", Mode::Plan).unwrap();
        assert!(
            prompt.contains("...") && prompt.contains("\"severity\"") && prompt.contains(READ_ONLY)
        );
    }

    #[test]
    fn prompts_always_forbid_edits() {
        let task = AgentTask::Custom {
            prompt: "Summarize the README".into(),
        };
        assert!(
            build_prompt(&task, "fr", Mode::Plan)
                .unwrap()
                .contains(READ_ONLY)
        );
    }

    #[test]
    fn claude_runs_in_plan_mode_without_edit_tools() {
        let cmd = command(
            AgentKind::Claude,
            Path::new("claude"),
            Path::new("/tmp"),
            &RunSettings::default(),
            None,
        );
        let args: Vec<_> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let mode = args.iter().position(|a| a == "--permission-mode").unwrap();
        let banned = args.iter().position(|a| a == "--disallowedTools").unwrap();
        assert_eq!(
            (args[mode + 1].as_str(), args[banned + 1].as_str()),
            ("plan", "Edit")
        );
    }

    #[test]
    fn events_reach_the_ui_in_camel_case() {
        let event = RunEvent::Session {
            run_id: "run-1".into(),
            session_id: "abc".into(),
        };
        let json = serde_json::to_value(event).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"type": "session", "runId": "run-1", "sessionId": "abc"})
        );
    }

    #[test]
    fn auto_mode_lets_claude_act_without_the_read_only_guard() {
        let settings = RunSettings {
            mode: Mode::Auto,
            model: Some("opus".into()),
            effort: Some("high".into()),
            images: Vec::new(),
            worktree: None,
        };
        let args: Vec<_> = command(
            AgentKind::Claude,
            Path::new("claude"),
            Path::new("/tmp"),
            &settings,
            None,
        )
        .get_args()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
        assert!(
            args.windows(2).any(|w| w == ["--permission-mode", "auto"])
                && !args.contains(&"--disallowedTools".to_string())
        );
        assert!(
            args.windows(2).any(|w| w == ["--model", "opus"])
                && args.windows(2).any(|w| w == ["--effort", "high"])
        );
    }

    #[test]
    fn codex_gets_images_in_one_argument() {
        let settings = RunSettings {
            images: vec!["/a/x.png".into()],
            ..RunSettings::default()
        };
        let args: Vec<_> = command(
            AgentKind::Codex,
            Path::new("codex"),
            Path::new("/tmp"),
            &settings,
            None,
        )
        .get_args()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
        assert!(args.contains(&"--image=/a/x.png".to_string()));
    }

    #[test]
    fn models_cannot_smuggle_flags() {
        let settings = RunSettings {
            mode: Mode::Plan,
            model: Some("--dangerously-skip-permissions".into()),
            effort: None,
            images: Vec::new(),
            worktree: None,
        };
        assert!(settings.validate().is_ok()); // a lone value after --model is never parsed as a flag…
        let bad = RunSettings {
            mode: Mode::Plan,
            model: Some("opus; rm -rf /".into()),
            effort: None,
            images: Vec::new(),
            worktree: None,
        };
        assert!(bad.validate().is_err()); // …and anything that isn't a model name is refused
    }
}
