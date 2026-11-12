import type { GitErrorPayload } from "@/types/git";

function isGitError(value: unknown): value is GitErrorPayload {
  return typeof value === "object" && value !== null && "kind" in value && "message" in value;
}

/** Normalizes anything thrown by `invoke` (a Rust GitError, a string, an Error) into a GitErrorPayload. */
export function toGitError(error: unknown): GitErrorPayload {
  if (isGitError(error)) return error;
  if (error instanceof Error) return { kind: "io", message: error.message, detail: null };
  // A JSON-RPC error from a language server (Copilot…): `{ code, message, data }`.
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string")
    return { kind: "io", message: error.message, detail: null };
  return { kind: "io", message: String(error), detail: null };
}
