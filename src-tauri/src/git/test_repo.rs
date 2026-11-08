//! Throwaway repositories for tests. Write operations are only ever exercised here, never on real projects.

use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

pub struct TestRepo {
    dir: TempDir,
}

impl TestRepo {
    /// Empty repository on branch `main`, with local identity and signing disabled.
    pub fn new() -> Self {
        let repo = Self {
            dir: tempfile::tempdir().expect("tempdir"),
        };
        repo.git(&["init", "-q", "-b", "main"]);
        for (key, value) in [
            ("user.name", "Test User"),
            ("user.email", "test@example.com"),
            ("commit.gpgsign", "false"),
            ("core.hooksPath", "/dev/null"),
        ] {
            repo.git(&["config", key, value]);
        }
        repo
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn write(&self, rel: &str, content: impl AsRef<[u8]>) {
        let file = self.path().join(rel);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, content).unwrap();
    }

    pub fn git(&self, args: &[&str]) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(self.path())
            .args(args)
            .output()
            .expect("git");
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// Stages everything and commits; returns the new commit hash.
    pub fn commit_all(&self, message: &str) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
        self.git(&["rev-parse", "HEAD"])
    }
}
