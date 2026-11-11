//! Tags: list, create (lightweight or annotated), delete, and push or delete them on `origin`.
//! Never `--force`: an existing tag is refused locally, and a push never moves a remote tag.

use std::path::Path;

use serde::Serialize;

use super::errors::{GitError, GitResult};
use super::runner::{NETWORK_TIMEOUT, RunOptions, git, git_text, git_with};
use super::validate;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    /// The commit the tag points to (peeled through an annotated tag).
    pub target: String,
    /// Tagging date for an annotated tag, the commit's date for a lightweight one (ISO 8601).
    pub date: String,
    /// Only annotated tags carry a message.
    pub message: Option<String>,
}

const FORMAT: &str = "--format=%(refname:strip=2)%00%(objecttype)%00%(objectname)%00%(*objectname)%00%(creatordate:iso-strict)%00%(contents)%1e";

/// Newest first.
pub fn list_tags(repo: &Path) -> GitResult<Vec<Tag>> {
    let text = git_text(
        repo,
        &["for-each-ref", "--sort=-creatordate", FORMAT, "refs/tags"],
    )?;
    Ok(text.split('\x1e').filter_map(parse_tag).collect())
}

fn parse_tag(record: &str) -> Option<Tag> {
    let mut fields = record.trim_start_matches('\n').splitn(6, '\0');
    let name = fields.next().filter(|n| !n.is_empty())?.to_string();
    let annotated = fields.next()? == "tag";
    let (object, peeled) = (fields.next()?, fields.next()?);
    let date = fields.next()?.to_string();
    let message = fields.next().unwrap_or_default().trim();
    Some(Tag {
        name,
        target: if annotated { peeled } else { object }.to_string(),
        date,
        message: (annotated && !message.is_empty()).then(|| message.to_string()),
    })
}

/// A tag name git accepts, never read as an option.
pub fn tag_name<'a>(repo: &Path, name: &'a str) -> GitResult<&'a str> {
    let invalid = || GitError::invalid(format!("“{name}” isn't a valid tag name."));
    let name = validate::revision(name).map_err(|_| invalid())?;
    git(repo, &["check-ref-format", &format!("refs/tags/{name}")]).map_err(|_| invalid())?;
    Ok(name)
}

/// Tags `target` (HEAD when absent). With a message the tag is annotated, the message going in on stdin.
pub fn create_tag(
    repo: &Path,
    name: &str,
    target: Option<&str>,
    message: Option<&str>,
) -> GitResult<()> {
    let name = tag_name(repo, name.trim())?;
    let target = validate::revision(target.unwrap_or("HEAD"))?;
    match message.map(str::trim).filter(|m| !m.is_empty()) {
        None => git(repo, &["tag", name, target]).map(drop),
        Some(message) => {
            let opts = RunOptions {
                stdin: Some(message.as_bytes()),
                ..RunOptions::default()
            };
            git_with(repo, &["tag", "-a", "-F", "-", name, target], &opts).map(drop)
        }
    }
}

pub fn delete_tag(repo: &Path, name: &str) -> GitResult<()> {
    let name = tag_name(repo, name)?;
    git(repo, &["tag", "-d", name]).map(drop)
}

const NETWORK: RunOptions = RunOptions {
    timeout: NETWORK_TIMEOUT,
    stdin: None,
    ok_codes: &[],
    env: &[],
};

/// `git push origin refs/tags/<name>`: fails rather than replacing a different tag of that name.
pub fn push_tag(repo: &Path, name: &str) -> GitResult<()> {
    let name = tag_name(repo, name)?;
    let refspec = format!("refs/tags/{name}");
    git_with(repo, &["push", "origin", &refspec], &NETWORK).map(drop)
}

/// Removes the tag from `origin` only; the local tag stays.
pub fn delete_remote_tag(repo: &Path, name: &str) -> GitResult<()> {
    let name = tag_name(repo, name)?;
    let refspec = format!("refs/tags/{name}");
    git_with(repo, &["push", "--delete", "origin", &refspec], &NETWORK).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    fn committed() -> (TestRepo, String) {
        let repo = TestRepo::new();
        repo.write("a.txt", "a");
        let head = repo.commit_all("first");
        (repo, head)
    }

    #[test]
    fn lightweight_tag_points_at_head() {
        let (repo, head) = committed();
        create_tag(repo.path(), "v1.0.0", None, None).unwrap();
        let tag = &list_tags(repo.path()).unwrap()[0];
        assert_eq!(
            (
                tag.name.as_str(),
                tag.target.as_str(),
                tag.message.as_deref()
            ),
            ("v1.0.0", head.as_str(), None)
        );
    }

    #[test]
    fn annotated_tag_keeps_its_message_and_peels_to_the_commit() {
        let (repo, first) = committed();
        repo.write("b.txt", "b");
        repo.commit_all("second");
        create_tag(
            repo.path(),
            "v0.1",
            Some(&first),
            Some("First release\n\nNotes"),
        )
        .unwrap();
        let tag = &list_tags(repo.path()).unwrap()[0];
        assert_eq!(
            (tag.target.as_str(), tag.message.as_deref()),
            (first.as_str(), Some("First release\n\nNotes"))
        );
    }

    #[test]
    fn refuses_option_like_names() {
        let (repo, _) = committed();
        assert!(create_tag(repo.path(), "-d", None, None).is_err());
    }

    #[test]
    fn refuses_names_git_rejects() {
        let (repo, _) = committed();
        assert!(create_tag(repo.path(), "bad..name", None, None).is_err());
    }

    #[test]
    fn never_overwrites_an_existing_tag() {
        let (repo, _) = committed();
        create_tag(repo.path(), "v1", None, None).unwrap();
        assert!(create_tag(repo.path(), "v1", None, Some("again")).is_err());
    }

    #[test]
    fn delete_removes_the_local_tag() {
        let (repo, _) = committed();
        create_tag(repo.path(), "v1", None, None).unwrap();
        delete_tag(repo.path(), "v1").unwrap();
        assert!(list_tags(repo.path()).unwrap().is_empty());
    }

    fn with_origin() -> (TestRepo, TestRepo) {
        let (repo, _) = committed();
        let origin = TestRepo::new();
        let origin_path = origin.path().to_str().unwrap().to_string();
        repo.git(&["remote", "add", "origin", &origin_path]);
        (repo, origin)
    }

    #[test]
    fn push_publishes_the_tag_on_origin() {
        let (repo, origin) = with_origin();
        create_tag(repo.path(), "v2", None, Some("two")).unwrap();
        push_tag(repo.path(), "v2").unwrap();
        assert_eq!(origin.git(&["tag", "--list"]), "v2");
    }

    #[test]
    fn delete_remote_tag_keeps_the_local_one() {
        let (repo, origin) = with_origin();
        create_tag(repo.path(), "v3", None, None).unwrap();
        push_tag(repo.path(), "v3").unwrap();
        delete_remote_tag(repo.path(), "v3").unwrap();
        assert_eq!(
            (
                origin.git(&["tag", "--list"]),
                list_tags(repo.path()).unwrap().len()
            ),
            (String::new(), 1)
        );
    }
}
