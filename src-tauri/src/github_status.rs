//! GitHub's own status page (githubstatus.com): ongoing incidents and degraded services, shown in the app
//! when pushing, pull requests or CI may fail for reasons that aren't the user's.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::git::errors::{ErrorKind, GitError, GitResult};

const SUMMARY: &str = "https://www.githubstatus.com/api/v2/summary.json";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Incident {
    pub name: String,
    /// none, minor, major or critical.
    pub impact: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    pub incidents: Vec<Incident>,
    /// Services not fully operational ("Pull Requests", "Actions"…).
    pub degraded: Vec<String>,
}

pub fn status() -> GitResult<GithubStatus> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .into();
    let io = |err: ureq::Error| {
        GitError::new(ErrorKind::Io, format!("GitHub status unreachable: {err}"))
    };
    let body: Value = agent
        .get(SUMMARY)
        .call()
        .map_err(io)?
        .body_mut()
        .read_json()
        .map_err(io)?;
    Ok(parse(&body))
}

fn parse(body: &Value) -> GithubStatus {
    let list = |key: &str| {
        body.get(key)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let text = |v: &Value, key: &str| {
        v.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let incidents = list("incidents")
        .iter()
        .filter(|i| {
            !matches!(
                i.get("status").and_then(Value::as_str),
                Some("resolved" | "postmortem")
            )
        })
        .map(|i| Incident {
            name: text(i, "name"),
            impact: text(i, "impact"),
            // Only githubstatus.com links: the URL is opened in the user's browser.
            url: Some(text(i, "shortlink"))
                .filter(|u| u.starts_with("https://"))
                .unwrap_or_else(|| "https://www.githubstatus.com/".into()),
        })
        .collect();
    let degraded = list("components")
        .iter()
        .filter(|c| c.get("group") != Some(&Value::Bool(true)))
        .filter(|c| {
            c.get("status")
                .and_then(Value::as_str)
                .is_some_and(|s| s != "operational")
        })
        .map(|c| text(c, "name"))
        // "Visit www.githubstatus.com for more information" is a component too.
        .filter(|name| !name.starts_with("Visit "))
        .collect();
    GithubStatus {
        incidents,
        degraded,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_unresolved_incidents_and_degraded_services() {
        let body = json!({
            "incidents": [
                { "name": "Degraded PRs", "status": "investigating", "impact": "minor", "shortlink": "https://stspg.io/x" },
                { "name": "Old", "status": "resolved", "impact": "major", "shortlink": "https://stspg.io/y" }
            ],
            "components": [
                { "name": "Pull Requests", "status": "degraded_performance" },
                { "name": "Actions", "status": "operational" },
                { "name": "Visit www.githubstatus.com for more information", "status": "major_outage" }
            ]
        });
        assert_eq!(
            parse(&body),
            GithubStatus {
                incidents: vec![Incident {
                    name: "Degraded PRs".into(),
                    impact: "minor".into(),
                    url: "https://stspg.io/x".into()
                }],
                degraded: vec!["Pull Requests".into()],
            }
        );
    }
}
