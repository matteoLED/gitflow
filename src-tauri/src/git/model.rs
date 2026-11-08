//! Types serialized to the frontend. Mirror of `src/types/git.ts`, keep both in sync.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct HeadInfo {
    /// Checked-out branch; `None` when HEAD is detached.
    pub branch: Option<String>,
    /// True for a repository without any commit yet.
    pub unborn: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalBranch {
    pub name: String,
    pub upstream: Option<String>,
    pub upstream_gone: bool,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranch {
    pub remote: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RefsSnapshot {
    pub head: HeadInfo,
    pub branches: Vec<LocalBranch>,
    pub remotes: Vec<RemoteBranch>,
    pub tags: Vec<String>,
    pub stashes: Vec<Stash>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    Head,
    Branch,
    Remote,
    Tag,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitRef {
    pub kind: RefKind,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub hash: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub author: String,
    pub author_email: String,
    pub co_authors: Vec<String>,
    pub authored_at: String,
    pub refs: Vec<CommitRef>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Unmerged,
    Untracked,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: FileStatus,
    pub binary: bool,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeEntry {
    pub path: String,
    pub previous_path: Option<String>,
    /// Change recorded in the index (staged), if any.
    pub staged: Option<FileStatus>,
    /// Change in the working tree not yet staged (includes untracked files), if any.
    pub unstaged: Option<FileStatus>,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// Unified diff for a single file; empty for binary files.
    pub patch: String,
    pub binary: bool,
}
