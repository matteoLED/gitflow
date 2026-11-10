//! The only place that spawns processes: `git`, or the GitHub CLI for read-only metadata.
//! Always an argument vector, never a shell.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::errors::{ErrorKind, GitError, GitResult};

pub const READ_TIMEOUT: Duration = Duration::from_secs(30);
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(180);
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

pub fn git(repo: &Path, args: &[&str]) -> GitResult<Vec<u8>> {
    git_with(repo, args, &RunOptions::default())
}

pub fn git_text(repo: &Path, args: &[&str]) -> GitResult<String> {
    git(repo, args).map(|out| String::from_utf8_lossy(&out).into_owned())
}

pub fn git_with(repo: &Path, args: &[&str], opts: &RunOptions) -> GitResult<Vec<u8>> {
    let mut cmd = git_command(repo, args);
    cmd.envs(opts.env.iter().copied());
    execute(cmd, args, opts)
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

fn execute(cmd: Command, args: &[&str], opts: &RunOptions) -> GitResult<Vec<u8>> {
    let mut child = spawn(cmd, opts.stdin.is_some())?;
    let stdout = read_pipe(child.stdout.take());
    let stderr = read_pipe(child.stderr.take());
    if let (Some(input), Some(mut pipe)) = (opts.stdin, child.stdin.take()) {
        pipe.write_all(input).map_err(io_error)?; // pipe drops here, closing git's stdin
    }
    let status = wait(&mut child, opts.timeout, args)?;
    let stdout = stdout.join().unwrap_or_default();
    let stderr = String::from_utf8_lossy(&stderr.join().unwrap_or_default()).into_owned();
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
    Err(command_failed(&stderr, code))
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

fn read_pipe<R: Read + Send + 'static>(pipe: Option<R>) -> JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = pipe {
            // Reading one byte past the cap is enough to detect overflow; the rest is drained so git never blocks.
            let mut limited = pipe.take(MAX_OUTPUT_BYTES + 1);
            let _ = limited.read_to_end(&mut buf);
            let _ = std::io::copy(&mut limited.into_inner(), &mut std::io::sink());
        }
        buf
    })
}

fn wait(child: &mut Child, timeout: Duration, args: &[&str]) -> GitResult<ExitStatus> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait().map_err(io_error)? {
            return Ok(status);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let name = args.first().copied().unwrap_or("git");
            return Err(GitError::new(
                ErrorKind::Timeout,
                format!("`git {name}` took too long and was stopped."),
            ));
        }
        thread::sleep(Duration::from_millis(10));
    }
}

/// First meaningful stderr line, without git's "fatal:"/"error:" prefix, as the user-facing message.
fn command_failed(stderr: &str, code: i32) -> GitError {
    let headline = stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("hint:"))
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
