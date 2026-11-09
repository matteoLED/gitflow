//! Turns Claude Code (`stream-json`, session `.jsonl`) and Codex (`exec --json`) events into one
//! timeline shape the UI can draw, whatever the agent.

use serde::Serialize;
use serde_json::Value;

const MAX_DETAIL: usize = 4_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StepKind {
    Info,
    Prompt,
    Thinking,
    Message,
    Tool,
    ToolResult,
    Result,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStep {
    pub kind: StepKind,
    pub title: String,
    pub detail: Option<String>,
    pub at: Option<String>,
}

pub fn step(kind: StepKind, title: impl Into<String>, detail: Option<String>) -> AgentStep {
    AgentStep {
        kind,
        title: title.into(),
        detail: detail.map(|d| clip(&d, MAX_DETAIL)),
        at: None,
    }
}

pub fn clip(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &text[..end])
}

fn first_line(text: &str, max: usize) -> String {
    clip(
        text.lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim(),
        max,
    )
}

fn str_at<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// One-line summary of a tool call: the file, command or pattern it works on.
fn tool_summary(name: &str, input: &Value) -> String {
    let target = [
        "command",
        "file_path",
        "path",
        "pattern",
        "url",
        "query",
        "description",
        "prompt",
    ]
    .iter()
    .find_map(|key| str_at(input, key))
    .map(|t| first_line(t, 160));
    match target {
        Some(t) if !t.is_empty() => format!("{name} · {t}"),
        _ => name.to_string(),
    }
}

fn tool_result_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|i| str_at(i, "text"))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// System reminders, hook output and slash-command plumbing are not things the user typed.
fn is_noise(text: &str) -> bool {
    let t = text.trim_start();
    t.is_empty() || t.starts_with('<') || t.starts_with("Caveat:")
}

/// Claude Code message (live `stream-json` or a saved session line).
pub fn from_claude(event: &Value) -> Vec<AgentStep> {
    let content = event.pointer("/message/content");
    let mut steps = match (str_at(event, "type"), content) {
        (Some("system"), _) if str_at(event, "subtype") == Some("init") => {
            let model = str_at(event, "model").unwrap_or("Claude");
            vec![step(
                StepKind::Info,
                format!("Session started · {model}"),
                None,
            )]
        }
        (Some("user"), Some(Value::String(text))) if !is_noise(text) => {
            vec![step(
                StepKind::Prompt,
                first_line(text, 200),
                Some(text.clone()),
            )]
        }
        (Some("user"), Some(Value::Array(items))) => {
            items.iter().filter_map(claude_user_item).collect()
        }
        (Some("assistant"), Some(Value::Array(items))) => {
            items.iter().filter_map(claude_assistant_item).collect()
        }
        (Some("result"), _) => vec![claude_result(event)],
        _ => Vec::new(),
    };
    let at = str_at(event, "timestamp").map(str::to_string);
    for s in &mut steps {
        s.at.clone_from(&at);
    }
    steps
}

fn claude_user_item(item: &Value) -> Option<AgentStep> {
    match str_at(item, "type")? {
        "text" => {
            let text = str_at(item, "text")?;
            (!is_noise(text)).then(|| {
                step(
                    StepKind::Prompt,
                    first_line(text, 200),
                    Some(text.to_string()),
                )
            })
        }
        "tool_result" => {
            let text = tool_result_text(item.get("content").unwrap_or(&Value::Null));
            let failed = item
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let kind = if failed {
                StepKind::Error
            } else {
                StepKind::ToolResult
            };
            Some(step(kind, first_line(&text, 160), Some(text)))
        }
        _ => None,
    }
}

fn claude_assistant_item(item: &Value) -> Option<AgentStep> {
    match str_at(item, "type")? {
        "text" => {
            let text = str_at(item, "text")?;
            Some(step(
                StepKind::Message,
                first_line(text, 200),
                Some(text.to_string()),
            ))
        }
        "thinking" => {
            let text = str_at(item, "thinking").unwrap_or_default();
            (!text.is_empty()).then(|| {
                step(
                    StepKind::Thinking,
                    first_line(text, 200),
                    Some(text.to_string()),
                )
            })
        }
        "tool_use" => {
            let name = str_at(item, "name").unwrap_or("tool");
            let input = item.get("input").cloned().unwrap_or(Value::Null);
            let detail = serde_json::to_string_pretty(&input).ok();
            Some(step(StepKind::Tool, tool_summary(name, &input), detail))
        }
        _ => None,
    }
}

fn claude_result(event: &Value) -> AgentStep {
    let failed = event
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let seconds = event
        .get("duration_ms")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        / 1000.0;
    let turns = event.get("num_turns").and_then(Value::as_u64).unwrap_or(0);
    let mut title = format!(
        "{} · {seconds:.0}s · {turns} turns",
        if failed { "Failed" } else { "Done" }
    );
    if let Some(cost) = event.get("total_cost_usd").and_then(Value::as_f64) {
        title.push_str(&format!(" · ${cost:.2}"));
    }
    let kind = if failed {
        StepKind::Error
    } else {
        StepKind::Result
    };
    step(kind, title, str_at(event, "result").map(str::to_string))
}

/// Codex `exec --json` event.
pub fn from_codex(event: &Value) -> Vec<AgentStep> {
    let item = event.get("item").unwrap_or(&Value::Null);
    let item_type = str_at(item, "type").unwrap_or_default();
    let found = match (str_at(event, "type").unwrap_or_default(), item_type) {
        ("thread.started", _) => Some(step(StepKind::Info, "Session started · Codex", None)),
        ("item.completed", "agent_message") => {
            let text = str_at(item, "text").unwrap_or_default();
            Some(step(
                StepKind::Message,
                first_line(text, 200),
                Some(text.to_string()),
            ))
        }
        ("item.completed", "reasoning") => {
            let text = str_at(item, "text").unwrap_or_default();
            Some(step(
                StepKind::Thinking,
                first_line(text, 200),
                Some(text.to_string()),
            ))
        }
        ("item.started", "command_execution") => Some(step(
            StepKind::Tool,
            format!("Shell · {}", str_at(item, "command").unwrap_or_default()),
            None,
        )),
        ("item.completed", "command_execution") => {
            let output = str_at(item, "aggregated_output")
                .unwrap_or_default()
                .to_string();
            let failed = item
                .get("exit_code")
                .and_then(Value::as_i64)
                .is_some_and(|c| c != 0);
            let kind = if failed {
                StepKind::Error
            } else {
                StepKind::ToolResult
            };
            Some(step(kind, first_line(&output, 160), Some(output)))
        }
        ("item.started", "mcp_tool_call" | "web_search" | "file_change") => {
            let name = str_at(item, "tool")
                .or(str_at(item, "query"))
                .unwrap_or(item_type);
            Some(step(
                StepKind::Tool,
                name.to_string(),
                serde_json::to_string_pretty(item).ok(),
            ))
        }
        ("turn.completed", _) => {
            let tokens = event
                .pointer("/usage/output_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            Some(step(
                StepKind::Result,
                format!("Done · {tokens} output tokens"),
                None,
            ))
        }
        ("turn.failed" | "error", _) => {
            let message = event
                .pointer("/error/message")
                .or(event.get("message"))
                .and_then(Value::as_str);
            Some(step(
                StepKind::Error,
                message.unwrap_or("Codex failed").to_string(),
                None,
            ))
        }
        _ => None,
    };
    found.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_tool_calls_name_their_target() {
        let event = json!({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Bash", "input": {"command": "git diff a..b"}}
        ]}});
        assert_eq!(from_claude(&event)[0].title, "Bash · git diff a..b");
    }

    #[test]
    fn claude_system_reminders_are_not_prompts() {
        let event =
            json!({"type": "user", "message": {"content": "<system-reminder>x</system-reminder>"}});
        assert!(from_claude(&event).is_empty());
    }

    #[test]
    fn claude_result_reports_duration_and_cost() {
        let event = json!({"type": "result", "duration_ms": 12000, "num_turns": 3, "total_cost_usd": 0.1234, "result": "LGTM"});
        assert_eq!(from_claude(&event)[0].title, "Done · 12s · 3 turns · $0.12");
    }

    #[test]
    fn codex_failed_commands_are_errors() {
        let event = json!({"type": "item.completed", "item": {"type": "command_execution", "aggregated_output": "boom", "exit_code": 1}});
        assert_eq!(from_codex(&event)[0].kind, StepKind::Error);
    }

    #[test]
    fn clipping_respects_utf8_boundaries() {
        assert_eq!(clip("ééé", 3), "é…");
    }
}
