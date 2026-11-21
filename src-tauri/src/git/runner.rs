//! The only place that spawns processes: `git`, or the GitHub CLI for read-only metadata.
//! Always an argument vector, never a shell.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, sync_channel};
use std::thread;
use std::time::{Duration, Instant};

use super::errors::{ErrorKind, GitError, GitResult};

pub const READ_TIMEOUT: Duration = Duration::from_secs(30);
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(180);
/// Commits, merges and pushes run the repository's hooks, which may lint, test or build (a minute or more).
pub const HOOK_TIMEOUT: Duration = Duration::from_secs(900);
const MAX_OUTPUT_BYTES: u64 = 32 * 1024 * 1024;

pub struct RunOptions<'a> {
    pub timeout: Duration,
    pub stdin: Option<&'a [u8]>,
    /// Exit codes treated as success besides 0 (`git diff --no-index` exits 1 when files differ).
    pub ok_codes: &'a [i32],
    /// Extra environment, e.g. the editors a non-interactive rebase uses instead of the user's.
    pub env: &'a [(&'a str, &'a str)],
}

impl Default for RunOptions<'_> {
    fn default() -> Self {
        Self {
            timeout: READ_TIMEOUT,
            stdin: None,
            ok_codes: &[],
            env: &[],
        }
    }
}

/// PATH plus the usual Homebrew folders: an app opened from the Finder doesn't get the shell's PATH,
/// and `git lfs` (or LFS filters during a submodule checkout) need `git-lfs` from there.
pub fn extended_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    format!("{current}:/opt/homebrew/bin:/usr/local/bin")
}

pub fn git(repo: &Path, args: &[&str]) -> GitResult<Vec<u8>> {
    git_with(repo, args, &RunOptions::default())
}

pub fn git_text(repo: &Path, args: &[&str]) -> GitResult<String> {
    git(repo, args).map(|out| String::from_utf8_lossy(&out).into_owned())
}

pub fn git_with(repo: &Path, args: &[&str], opts: &RunOptions) -> GitResult<Vec<u8>> {
    let mut cmd = git_command(repo, args);
    cmd.envs(opts.env.iter().copied());
    execute(cmd, args, opts).map_err(|err| match err.kind {
        ErrorKind::Timeout => mention_index_lock(repo, err),
        _ => err,
    })
}

/// Runs two independent reads at once (each is mostly a wait on its own git process).
pub fn both<A: Send, B: Send>(
    a: impl FnOnce() -> A + Send,
    b: impl FnOnce() -> B + Send,
) -> (A, B) {
    thread::scope(|scope| {
        let b = scope.spawn(b);
        let a = a();
        (a, b.join().unwrap_or_else(|e| std::panic::resume_unwind(e)))
    })
}

/// A long write (rebase, cherry-pick, revert: hooks and big trees) killed mid-way leaves a half-done state,
/// so it gets the hook timeout rather than the read one.
pub fn git_long(repo: &Path, args: &[&str]) -> GitResult<Vec<u8>> {
    // Rebases, merges and commits run the repository's hooks, which may lint, test or build.
    let opts = RunOptions {
        timeout: HOOK_TIMEOUT,
        ..RunOptions::default()
    };
    git_with(repo, args, &opts)
}

/// A git killed mid-write can leave its index lock behind. Deleting it is the user's call: it is only named.
fn mention_index_lock(repo: &Path, mut err: GitError) -> GitError {
    let args = ["rev-parse", "--git-path", "index.lock"];
    let Ok(out) = execute(git_command(repo, &args), &args, &RunOptions::default()) else {
        return err;
    };
    let lock = repo.join(String::from_utf8_lossy(&out).trim());
    if lock.exists() {
        err.message.push_str(&format!(
            " Git's lock file {} is still there: once no git command is running, delete it to go on.",
            lock.display()
        ));
    }
    err
}

/// Runs `gh` (an absolute path found by the caller) in `repo`, using the user's own GitHub login.
pub fn gh(program: &Path, repo: &Path, args: &[&str]) -> GitResult<Vec<u8>> {
    let mut cmd = Command::new(program);
    cmd.current_dir(repo)
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1");
    execute(
        cmd,
        args,
        &RunOptions {
            timeout: Duration::from_secs(15),
            ..RunOptions::default()
        },
    )
}

/// `gh` with a body on stdin (`gh api --input -`), for JSON payloads that `-f` fields can't express.
pub fn gh_with_input(
    program: &Path,
    repo: &Path,
    args: &[&str],
    input: &[u8],
) -> GitResult<Vec<u8>> {
    let mut cmd = Command::new(program);
    cmd.current_dir(repo)
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1");
    execute(
        cmd,
        args,
        &RunOptions {
            timeout: Duration::from_secs(30),
            stdin: Some(input),
            ..RunOptions::default()
        },
    )
}

fn execute(cmd: Command, args: &[&str], opts: &RunOptions) -> GitResult<Vec<u8>> {
    let mut child = spawn(cmd, opts.stdin.is_some())?;
    let stdout = read_pipe(child.stdout.take());
    let stderr = read_pipe(child.stderr.take());
    if let (Some(input), Some(mut pipe)) = (opts.stdin, child.stdin.take()) {
        pipe.write_all(input).map_err(io_error)?; // pipe drops here, closing git's stdin
    }
    let (status, stdout) = wait(&mut child, stdout, opts.timeout, args)?;
    let stderr = String::from_utf8_lossy(&stderr.recv().unwrap_or_default()).into_owned();
    if stdout.len() as u64 > MAX_OUTPUT_BYTES {
        return Err(GitError::new(
            ErrorKind::OutputTooLarge,
            "Git output is too large to display.",
        ));
    }
    let code = status.code().unwrap_or(-1);
    if status.success() || opts.ok_codes.contains(&code) {
        return Ok(stdout);
    }
    // Hooks (husky, lint-staged) report on stdout as much as stderr: both are kept, stderr first.
    let stdout = String::from_utf8_lossy(&stdout);
    let output = [stderr.trim_end(), stdout.trim_end()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Err(command_failed(&output, code))
}

fn git_command(repo: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args([
            "-c",
            "core.quotepath=false",
            "-c",
            "color.ui=false",
            "-c",
            "core.pager=cat",
        ])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0") // fail instead of hanging on a credential prompt
        .env("GIT_OPTIONAL_LOCKS", "0") // reads never contend with the user's own git commands
        .env("GIT_LITERAL_PATHSPECS", "1"); // file names with `*`, `?` or `:` are never patterns
    cmd
}

fn spawn(mut cmd: Command, with_stdin: bool) -> GitResult<Child> {
    // Its own process group: a timeout stops the hooks git started (lint-staged, a build) along with it.
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    cmd.stdin(if with_stdin {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => GitError::new(
            ErrorKind::GitNotFound,
            "Git (or the GitHub CLI) is not installed or not on PATH.",
        ),
        _ => io_error(err),
    })
}

/// The pipe's whole content, sent once it closes (normally when git exits).
fn read_pipe<R: Read + Send + 'static>(pipe: Option<R>) -> Receiver<Vec<u8>> {
    let (tx, rx) = sync_channel(1);
    thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = pipe {
            // Reading one byte past the cap is enough to detect overflow; the rest is drained so git never blocks.
            let mut limited = pipe.take(MAX_OUTPUT_BYTES + 1);
            let _ = limited.read_to_end(&mut buf);
            let _ = std::io::copy(&mut limited.into_inner(), &mut std::io::sink());
        }
        let _ = tx.send(buf);
    });
    rx
}

/// Waits for git to exit, with its stdout. Its stdout closing (git exiting) wakes the wait at once, so a
/// quick command isn't rounded up to a polling tick; the poll remains for a pipe kept open by a child.
fn wait(
    child: &mut Child,
    stdout: Receiver<Vec<u8>>,
    timeout: Duration,
    args: &[&str],
) -> GitResult<(ExitStatus, Vec<u8>)> {
    const FIRST_PAUSE: Duration = Duration::from_micros(250);
    let deadline = Instant::now() + timeout;
    let (mut out, mut pause) = (None, FIRST_PAUSE);
    loop {
        if let Some(status) = child.try_wait().map_err(io_error)? {
            let out = out.unwrap_or_else(|| stdout.recv().unwrap_or_default());
            return Ok((status, out));
        }
        if Instant::now() >= deadline {
            // The whole group (git and its hooks), then git itself should it have left it.
            let _ = Command::new("/bin/kill")
                .args(["-TERM", &format!("-{}", child.id())])
                .status();
            let _ = child.kill();
            let _ = child.wait();
            let name = args.first().copied().unwrap_or("git");
            return Err(GitError::new(
                ErrorKind::Timeout,
                format!("`git {name}` took too long and was stopped."),
            ));
        }
        if out.is_some() {
            thread::sleep(pause);
        } else {
            match stdout.recv_timeout(pause) {
                Ok(bytes) => (out, pause) = (Some(bytes), FIRST_PAUSE),
                Err(RecvTimeoutError::Disconnected) => out = Some(Vec::new()),
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
        pause = (pause * 2).min(Duration::from_millis(10));
    }
}

/// The line that says what went wrong: a hook's failure (it comes last, after its progress lines), else the
/// first meaningful line, without git's "fatal:"/"error:" prefix.
fn command_failed(stderr: &str, code: i32) -> GitError {
    let lines = || stderr.lines().map(str::trim).filter(|l| !l.is_empty());
    let hook_failure = lines().rev().find(|l| {
        let lower = l.to_lowercase();
        l.starts_with('✖')
            || lower.starts_with("husky -")
            || lower.contains("command not found")
            || (lower.contains("error") && !l.starts_with('['))
    });
    let headline = hook_failure
        .or_else(|| lines().find(|line| !line.starts_with("hint:") && !line.starts_with('[')))
        .map(|line| {
            line.trim_start_matches("fatal: ")
                .trim_start_matches("error: ")
                .to_string()
        })
        .unwrap_or_else(|| format!("Git exited with code {code}."));
    GitError::new(ErrorKind::CommandFailed, headline).with_detail(stderr)
}

fn io_error(err: std::io::Error) -> GitError {
    GitError::new(ErrorKind::Io, err.to_string())
}

#[cfg(test)]
mod hook_tests {
    use super::*;

    #[test]
    fn a_failing_hook_is_summed_up_by_its_last_error() {
        let output = "[STARTED] Backing up original state...\n[STARTED] oxlint --fix\n✖ oxlint --fix:\nsrc/a.ts error\nhusky - pre-commit script failed (code 1)";
        assert_eq!(
            command_failed(output, 1).message,
            "husky - pre-commit script failed (code 1)"
        );
    }

    #[test]
    fn plain_git_errors_keep_their_first_line() {
        let err = command_failed("fatal: not a git repository\nhint: run git init", 128);
        assert_eq!(err.message, "not a git repository");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    #[test]
    fn a_timeout_names_a_leftover_index_lock() {
        let repo = TestRepo::new();
        repo.write(".git/index.lock", "");
        let err = mention_index_lock(repo.path(), GitError::new(ErrorKind::Timeout, "slow."));
        assert!(err.message.contains("index.lock"));
    }
}
