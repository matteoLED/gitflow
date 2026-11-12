//! Inline code completion through a model API (Claude or OpenAI). The editor builds the prompt (the code
//! around the cursor); this side holds the API keys, in the macOS Keychain, and never hands them back.
//! GitHub Copilot is a language server instead (see lsp.rs).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{Value, json};

use crate::git::errors::{ErrorKind, GitError, GitResult};

const KEYCHAIN_SERVICE: &str = "gitflow.completion";
const MAX_TOKENS: u32 = 128;
/// The editor sends ~8k characters of code; anything far bigger is refused before it leaves the machine.
const MAX_PROMPT: usize = 32_000;

const SYSTEM: &str = "You are a code completion engine. The user message holds a file with a <CURSOR> marker. \
Output ONLY the text to insert at <CURSOR>: no explanation, no Markdown fences, do not repeat the code before \
or after the cursor. Complete the current statement or a few lines at most. If nothing fits, output nothing.";

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Provider {
    Claude,
    OpenAi,
}

impl Provider {
    pub fn parse(name: &str) -> GitResult<Self> {
        match name {
            "claude" => Ok(Self::Claude),
            "openai" => Ok(Self::OpenAi),
            _ => Err(GitError::invalid("Unknown completion provider.")),
        }
    }
    fn account(self) -> &'static str {
        match self {
            Self::Claude => "anthropic",
            Self::OpenAi => "openai",
        }
    }
    fn models(self) -> &'static [&'static str] {
        match self {
            Self::Claude => &["claude-haiku-5-5", "claude-sonnet-5-5"],
            Self::OpenAi => &["gpt-4.1-mini", "gpt-4.1-nano"],
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude",
            Self::OpenAi => "OpenAI",
        }
    }
}

/// `sk-ant-…` for Anthropic, `sk-…` for OpenAI; plain token characters only, so nothing odd reaches a header.
pub fn valid_key(provider: Provider, key: &str) -> bool {
    let prefix = match provider {
        Provider::Claude => "sk-ant-",
        Provider::OpenAi => "sk-",
    };
    key.starts_with(prefix)
        && (20..=300).contains(&key.len())
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn check_model(provider: Provider, model: &str) -> GitResult<()> {
    if provider.models().contains(&model) {
        Ok(())
    } else {
        Err(GitError::invalid("Unknown model."))
    }
}

/// Keys read this launch: the Keychain is asked once, not on every keystroke.
fn cached_keys() -> &'static Mutex<HashMap<&'static str, String>> {
    static KEYS: OnceLock<Mutex<HashMap<&'static str, String>>> = OnceLock::new();
    KEYS.get_or_init(Default::default)
}

fn keychain(provider: Provider) -> GitResult<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, provider.account())
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Keychain: {err}")))
}

fn key_of(provider: Provider) -> Option<String> {
    let mut cache = cached_keys().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(key) = cache.get(provider.account()) {
        return Some(key.clone());
    }
    let key = keychain(provider).ok()?.get_password().ok()?;
    cache.insert(provider.account(), key.clone());
    Some(key)
}

pub fn has_key(provider: Provider) -> bool {
    key_of(provider).is_some()
}

pub fn set_key(provider: Provider, key: &str) -> GitResult<()> {
    let key = key.trim();
    if !valid_key(provider, key) {
        return Err(GitError::invalid(format!(
            "This isn't a {} API key.",
            provider.label()
        )));
    }
    keychain(provider)?
        .set_password(key)
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Keychain: {err}")))?;
    cached_keys()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(provider.account(), key.to_string());
    Ok(())
}

pub fn remove_key(provider: Provider) {
    cached_keys()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(provider.account());
    if let Ok(entry) = keychain(provider) {
        let _ = entry.delete_credential();
    }
}

fn request_body(provider: Provider, model: &str, prompt: &str) -> Value {
    match provider {
        // No sampling parameters (Haiku/Sonnet 5.5 reject non-default ones); thinking off for latency:
        // Haiku 5.5 takes `disabled`, Sonnet 5.5 only `between_tools`.
        Provider::Claude => json!({
            "model": model,
            "max_tokens": MAX_TOKENS,
            "thinking": { "type": if model.starts_with("claude-sonnet") { "between_tools" } else { "disabled" } },
            "system": SYSTEM,
            "messages": [{ "role": "user", "content": prompt }],
        }),
        Provider::OpenAi => json!({
            "model": model,
            "max_completion_tokens": MAX_TOKENS,
            "temperature": 0.2,
            "messages": [
                { "role": "system", "content": SYSTEM },
                { "role": "user", "content": prompt },
            ],
        }),
    }
}

/// The inserted text, or empty when the model declined or answered nothing.
fn parse_answer(provider: Provider, body: &Value) -> String {
    match provider {
        Provider::Claude => {
            if body.get("stop_reason").and_then(Value::as_str) == Some("refusal") {
                return String::new();
            }
            body.get("content")
                .and_then(Value::as_array)
                .map(|blocks| {
                    blocks
                        .iter()
                        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                        .filter_map(|b| b.get("text").and_then(Value::as_str))
                        .collect()
                })
                .unwrap_or_default()
        }
        Provider::OpenAi => body
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    }
}

/// Both APIs answer errors as `{ "error": { "message": … } }`.
fn error_message(status: u16, body: &Value) -> String {
    body.pointer("/error/message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("HTTP {status}"))
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(4)))
        .http_status_as_error(false)
        .build()
        .into()
}

/// Asks the model for the text at `<CURSOR>` in `prompt`.
pub fn complete(provider: Provider, model: &str, prompt: &str) -> GitResult<String> {
    check_model(provider, model)?;
    if prompt.len() > MAX_PROMPT {
        return Err(GitError::invalid("Too much code around the cursor."));
    }
    let key = key_of(provider).ok_or_else(|| {
        GitError::invalid(format!("Add a {} API key in Settings.", provider.label()))
    })?;
    let body = request_body(provider, model, prompt);
    let request = match provider {
        Provider::Claude => agent()
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01"),
        Provider::OpenAi => agent()
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", &format!("Bearer {key}")),
    };
    let unreachable =
        |err: ureq::Error| GitError::new(ErrorKind::Io, format!("{}: {err}", provider.label()));
    let mut response = request
        .header("content-type", "application/json")
        .send_json(body)
        .map_err(unreachable)?;
    let status = response.status().as_u16();
    let body: Value = response.body_mut().read_json().map_err(unreachable)?;
    if status >= 400 {
        let kind = if status == 401 || status == 403 {
            ErrorKind::InvalidInput
        } else {
            ErrorKind::Io
        };
        return Err(GitError::new(
            kind,
            format!("{}: {}", provider.label(), error_message(status, &body)),
        ));
    }
    Ok(parse_answer(provider, &body))
}

/// A tiny real request: proves the saved key and the model work.
pub fn test(provider: Provider, model: &str) -> GitResult<()> {
    complete(
        provider,
        model,
        "File: hello.py\nLanguage: Python\n\ndef add(a, b):\n    return <CURSOR>",
    )
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_checked_per_provider() {
        let claude = format!("sk-ant-api03-{}", "a".repeat(40));
        assert!(valid_key(Provider::Claude, &claude));
        assert!(valid_key(
            Provider::OpenAi,
            &format!("sk-proj-{}", "b".repeat(40))
        ));
        assert!(!valid_key(
            Provider::Claude,
            "sk-proj-abcdefghijklmnopqrstuvwxyz"
        ));
        assert!(!valid_key(Provider::OpenAi, "sk-short"));
        assert!(!valid_key(Provider::Claude, &format!("{claude}\r\nX: y")));
    }

    #[test]
    fn models_come_from_the_allow_list() {
        assert!(check_model(Provider::Claude, "claude-haiku-5-5").is_ok());
        assert!(check_model(Provider::Claude, "gpt-4.1-mini").is_err());
        assert!(Provider::parse("copilot").is_err());
    }

    #[test]
    fn claude_requests_turn_thinking_off_without_sampling() {
        let haiku = request_body(Provider::Claude, "claude-haiku-5-5", "x<CURSOR>");
        assert_eq!(haiku["thinking"]["type"], "disabled");
        assert_eq!(haiku["max_tokens"], 128);
        assert_eq!(haiku["messages"][0]["content"], "x<CURSOR>");
        assert!(haiku.get("temperature").is_none());
        let sonnet = request_body(Provider::Claude, "claude-sonnet-5-5", "x");
        assert_eq!(sonnet["thinking"]["type"], "between_tools");
    }

    #[test]
    fn openai_requests_carry_the_system_prompt() {
        let body = request_body(Provider::OpenAi, "gpt-4.1-mini", "x");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["content"], "x");
    }

    #[test]
    fn answers_are_read_from_each_api() {
        let claude = json!({ "stop_reason": "end_turn", "content": [
            { "type": "thinking", "thinking": "" },
            { "type": "text", "text": "a + b" },
        ]});
        assert_eq!(parse_answer(Provider::Claude, &claude), "a + b");
        let refused =
            json!({ "stop_reason": "refusal", "content": [{ "type": "text", "text": "no" }] });
        assert_eq!(parse_answer(Provider::Claude, &refused), "");
        let openai = json!({ "choices": [{ "message": { "content": "a + b" } }] });
        assert_eq!(parse_answer(Provider::OpenAi, &openai), "a + b");
        assert_eq!(parse_answer(Provider::OpenAi, &json!({})), "");
    }

    #[test]
    fn errors_use_the_api_message() {
        let body = json!({ "type": "error", "error": { "message": "invalid x-api-key" } });
        assert_eq!(error_message(401, &body), "invalid x-api-key");
        assert_eq!(error_message(502, &Value::Null), "HTTP 502");
    }
}
