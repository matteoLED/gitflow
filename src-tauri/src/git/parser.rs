//! Parsers for Git's machine formats. Every input is untrusted: names may hold spaces, unicode or odd bytes.

use std::collections::HashMap;

use super::model::*;

/// `git log` format consumed by [`parse_log`]: NUL between fields, RS (0x1e) after each record.
/// Co-authors come from `Co-authored-by:` trailers, separated by 0x1f.
pub const LOG_FORMAT: &str = "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%(trailers:key=Co-authored-by,valueonly,separator=%x1f)%x00%s%x1e";

/// `git for-each-ref` format consumed by [`parse_refs`].
pub const REF_FORMAT: &str =
    "--format=%(refname)%00%(upstream:short)%00%(upstream:track,nobracket)";

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn nul_tokens(bytes: &[u8]) -> Vec<String> {
    bytes
        .split(|b| *b == 0)
        .filter(|t| !t.is_empty())
        .map(lossy)
        .collect()
}

pub fn parse_log(bytes: &[u8]) -> Vec<CommitSummary> {
    bytes
        .split(|b| *b == 0x1e)
        .map(|record| lossy(record).trim_start_matches('\n').to_string())
        .filter(|record| !record.is_empty())
        .filter_map(|record| parse_log_record(&record))
        .collect()
}

fn parse_log_record(record: &str) -> Option<CommitSummary> {
    let mut fields = record.splitn(8, '\0');
    let hash = fields.next()?.to_string();
    let parents = fields
        .next()?
        .split_whitespace()
        .map(String::from)
        .collect();
    let author = fields.next()?.to_string();
    let author_email = fields.next()?.to_string();
    let authored_at = fields.next()?.to_string();
    let refs = parse_decorations(fields.next()?);
    let co_authors = co_author_names(fields.next()?);
    let subject = fields.next().unwrap_or_default().to_string();
    Some(CommitSummary {
        hash,
        parents,
        subject,
        author,
        author_email,
        co_authors,
        authored_at,
        refs,
    })
}

/// "Ana Lima <ana@x.io>" trailers → "Ana Lima".
fn co_author_names(field: &str) -> Vec<String> {
    field
        .split('\x1f')
        .map(|t| t.split('<').next().unwrap_or_default().trim().to_string())
        .filter(|name| !name.is_empty())
        .collect()
}

/// Parses `%D` produced with `--decorate=full`, e.g. `HEAD -> refs/heads/main, tag: refs/tags/v1`.
pub fn parse_decorations(text: &str) -> Vec<CommitRef> {
    text.split(", ")
        .filter(|item| !item.is_empty())
        .flat_map(|item| match item.strip_prefix("HEAD -> ") {
            Some(branch) => vec![
                CommitRef {
                    kind: RefKind::Head,
                    name: "HEAD".into(),
                },
                full_ref(branch),
            ],
            None => vec![full_ref(item.trim_start_matches("tag: "))],
        })
        .filter(|r| !(r.kind == RefKind::Remote && r.name.ends_with("/HEAD")))
        .collect()
}

fn full_ref(name: &str) -> CommitRef {
    let (kind, short) = if let Some(n) = name.strip_prefix("refs/heads/") {
        (RefKind::Branch, n)
    } else if let Some(n) = name.strip_prefix("refs/remotes/") {
        (RefKind::Remote, n)
    } else if let Some(n) = name.strip_prefix("refs/tags/") {
        (RefKind::Tag, n)
    } else {
        (RefKind::Head, name) // detached "HEAD" or an unusual ref namespace
    };
    CommitRef {
        kind,
        name: short.to_string(),
    }
}

/// Parses `for-each-ref` over refs/heads, refs/remotes and refs/tags into a snapshot (head and stashes left empty).
pub fn parse_refs(text: &str) -> RefsSnapshot {
    let mut snapshot = RefsSnapshot::default();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let mut fields = line.split('\0');
        let refname = fields.next().unwrap_or_default();
        let upstream = fields.next().unwrap_or_default();
        let track = fields.next().unwrap_or_default();
        if let Some(name) = refname.strip_prefix("refs/heads/") {
            snapshot.branches.push(local_branch(name, upstream, track));
        } else if let Some(rest) = refname.strip_prefix("refs/remotes/") {
            if let Some((remote, name)) = rest.split_once('/').filter(|(_, n)| *n != "HEAD") {
                snapshot.remotes.push(RemoteBranch {
                    remote: remote.into(),
                    name: name.into(),
                });
            }
        } else if let Some(tag) = refname.strip_prefix("refs/tags/") {
            snapshot.tags.push(tag.into());
        }
    }
    snapshot
}

fn local_branch(name: &str, upstream: &str, track: &str) -> LocalBranch {
    let count = |label: &str| {
        track
            .split(", ")
            .find_map(|part| part.strip_prefix(label)?.trim().parse().ok())
            .unwrap_or(0)
    };
    LocalBranch {
        name: name.into(),
        upstream: (!upstream.is_empty()).then(|| upstream.into()),
        upstream_gone: track == "gone",
        ahead: count("ahead "),
        behind: count("behind "),
    }
}

/// Parses `git stash list --format=%gd%x00%gs` (`stash@{0}\0message`).
pub fn parse_stashes(text: &str) -> Vec<Stash> {
    text.lines()
        .filter_map(|line| {
            let (selector, message) = line.split_once('\0')?;
            let index = selector
                .strip_prefix("stash@{")?
                .strip_suffix('}')?
                .parse()
                .ok()?;
            Some(Stash {
                index,
                message: message.into(),
            })
        })
        .collect()
}

pub fn status_from_letter(letter: char) -> Option<FileStatus> {
    match letter {
        'A' => Some(FileStatus::Added),
        'M' | 'T' => Some(FileStatus::Modified),
        'D' => Some(FileStatus::Deleted),
        'R' => Some(FileStatus::Renamed),
        'C' => Some(FileStatus::Copied),
        'U' => Some(FileStatus::Unmerged),
        '?' => Some(FileStatus::Untracked),
        _ => None,
    }
}

/// Parses `git diff --name-status -z -M`. Renames/copies carry two paths: old then new.
pub fn parse_name_status(bytes: &[u8]) -> Vec<ChangedFile> {
    let tokens = nul_tokens(bytes);
    let mut files = Vec::new();
    let mut iter = tokens.into_iter();
    while let Some(code) = iter.next() {
        let letter = code.chars().next().unwrap_or('M');
        let status = status_from_letter(letter).unwrap_or(FileStatus::Modified);
        let first = iter.next().unwrap_or_default();
        let (path, previous_path) = if matches!(letter, 'R' | 'C') {
            (iter.next().unwrap_or_default(), Some(first))
        } else {
            (first, None)
        };
        files.push(ChangedFile {
            path,
            previous_path,
            status,
            binary: false,
            additions: None,
            deletions: None,
        });
    }
    files
}

/// Parses `git diff --numstat -z -M` into `path -> (additions, deletions)`; `None` counts mean binary.
pub fn parse_numstat(bytes: &[u8]) -> HashMap<String, Option<(u32, u32)>> {
    let mut stats = HashMap::new();
    let mut tokens = bytes.split(|b| *b == 0).map(lossy);
    while let Some(record) = tokens.next() {
        let mut parts = record.splitn(3, '\t');
        let (Some(add), Some(del), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        // Renames leave the path field empty, followed by old and new paths as separate tokens.
        let path = if path.is_empty() {
            tokens.next();
            tokens.next().unwrap_or_default()
        } else {
            path.to_string()
        };
        stats.insert(path, add.parse().ok().zip(del.parse().ok()));
    }
    stats
}

/// Parses `git status --porcelain=v1 -z -uall`. Renamed entries are followed by their original path.
pub fn parse_status(bytes: &[u8]) -> Vec<WorkingTreeEntry> {
    let tokens = nul_tokens(bytes);
    let mut entries = Vec::new();
    let mut iter = tokens.into_iter();
    while let Some(token) = iter.next() {
        let mut chars = token.chars();
        let (Some(x), Some(y)) = (chars.next(), chars.next()) else {
            continue;
        };
        let path = token.get(3..).unwrap_or_default().to_string();
        let previous_path = if matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C') {
            iter.next()
        } else {
            None
        };
        entries.push(status_entry(x, y, path, previous_path));
    }
    entries
}

fn status_entry(x: char, y: char, path: String, previous_path: Option<String>) -> WorkingTreeEntry {
    let conflicted = x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D');
    if conflicted {
        return WorkingTreeEntry {
            path,
            previous_path,
            staged: None,
            unstaged: Some(FileStatus::Unmerged),
            conflicted,
        };
    }
    if x == '?' {
        return WorkingTreeEntry {
            path,
            previous_path,
            staged: None,
            unstaged: Some(FileStatus::Untracked),
            conflicted,
        };
    }
    WorkingTreeEntry {
        path,
        previous_path,
        staged: status_from_letter(x),
        unstaged: status_from_letter(y),
        conflicted,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_record_fields_are_split_on_nul() {
        let out = b"abc\0p1 p2\0Ana \xC3\x89\0ana@x.io\0 2026-01-02T03:04:05+01:00\0\0\0Merge: a\tb\x1e\n";
        let commits = parse_log(out);
        assert_eq!(commits[0].parents, vec!["p1", "p2"]);
    }

    #[test]
    fn log_keeps_unicode_authors() {
        let commits = parse_log(b"abc\0\0L\xC3\xA9a\0l@x.io\0d\0\0\0s\x1e");
        assert_eq!(commits[0].author, "Léa");
    }

    #[test]
    fn log_reads_co_author_names_from_trailers() {
        let commits = parse_log(b"abc\0\0Ana\0a@x.io\0d\0\0Bo Li <bo@x.io>\x1fCy <cy@x.io>\0s\x1e");
        assert_eq!(commits[0].co_authors, vec!["Bo Li", "Cy"]);
    }

    #[test]
    fn decorations_distinguish_head_branches_remotes_and_tags() {
        let refs = parse_decorations(
            "HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1",
        );
        let kinds: Vec<_> = refs.iter().map(|r| (r.kind, r.name.as_str())).collect();
        assert_eq!(
            kinds,
            vec![
                (RefKind::Head, "HEAD"),
                (RefKind::Branch, "main"),
                (RefKind::Remote, "origin/main"),
                (RefKind::Tag, "v1")
            ]
        );
    }

    #[test]
    fn refs_parse_ahead_behind_and_gone() {
        let text = "refs/heads/a\0origin/a\0ahead 2, behind 5\nrefs/heads/b\0origin/b\0gone\n";
        let snapshot = parse_refs(text);
        assert_eq!(
            (
                snapshot.branches[0].ahead,
                snapshot.branches[0].behind,
                snapshot.branches[1].upstream_gone
            ),
            (2, 5, true)
        );
    }

    #[test]
    fn refs_skip_remote_head_symref() {
        let snapshot = parse_refs("refs/remotes/origin/HEAD\0\0\nrefs/remotes/origin/feat/x\0\0\n");
        assert_eq!(
            snapshot.remotes,
            vec![RemoteBranch {
                remote: "origin".into(),
                name: "feat/x".into()
            }]
        );
    }

    #[test]
    fn stashes_parse_index() {
        assert_eq!(parse_stashes("stash@{3}\0WIP on main: x")[0].index, 3);
    }

    #[test]
    fn name_status_reads_renames_as_old_then_new() {
        let files = parse_name_status(b"R087\0old name.txt\0new name.txt\0M\0a.rs\0");
        assert_eq!(files[0].previous_path.as_deref(), Some("old name.txt"));
    }

    #[test]
    fn name_status_reads_plain_entries_after_a_rename() {
        let files = parse_name_status(b"R087\0old\0new\0D\0gone.rs\0");
        assert_eq!(
            (files[1].path.as_str(), files[1].status),
            ("gone.rs", FileStatus::Deleted)
        );
    }

    #[test]
    fn numstat_marks_binary_files_without_counts() {
        let stats = parse_numstat(b"-\t-\timg.png\x003\t1\tsrc/a.rs\0");
        assert_eq!(stats["img.png"], None);
    }

    #[test]
    fn numstat_keys_renames_by_new_path() {
        let stats = parse_numstat(b"1\t2\t\0old.rs\0new.rs\0");
        assert_eq!(stats["new.rs"], Some((1, 2)));
    }

    #[test]
    fn status_splits_staged_and_unstaged_changes() {
        let entries = parse_status(b"MM src/a.rs\0");
        assert_eq!(
            (entries[0].staged, entries[0].unstaged),
            (Some(FileStatus::Modified), Some(FileStatus::Modified))
        );
    }

    #[test]
    fn status_reads_rename_origin() {
        let entries = parse_status(b"R  new path.rs\0old path.rs\0?? notes.md\0");
        assert_eq!(entries[0].previous_path.as_deref(), Some("old path.rs"));
    }

    #[test]
    fn status_marks_untracked_as_unstaged() {
        let entries = parse_status(b"?? notes \xC3\xA9t\xC3\xA9.md\0");
        assert_eq!(entries[0].unstaged, Some(FileStatus::Untracked));
    }

    #[test]
    fn status_flags_conflicts() {
        assert!(parse_status(b"UU merge.rs\0")[0].conflicted);
    }
}
