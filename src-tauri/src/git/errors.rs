use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    GitNotFound,
    NotARepository,
    InvalidInput,
    CommandFailed,
    Timeout,
    OutputTooLarge,
    Io,
    /// A file changed on disk since it was read: saving would overwrite someone else's edit.
    ChangedOnDisk,
}

/// Error sent to the frontend: a readable `message` plus raw Git output in `detail` for diagnosis.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitError {
    pub kind: ErrorKind,
    pub message: String,
    pub detail: Option<String>,
}

impl GitError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::InvalidInput, message)
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        self.detail = (!detail.trim().is_empty()).then_some(detail);
        self
    }
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for GitError {}

pub type GitResult<T> = Result<T, GitError>;
