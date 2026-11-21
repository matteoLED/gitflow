import { ClaudeIcon, CodexIcon } from "@/features/agents/agent-icons";
import { cn } from "@/lib/utils";

export type CoAgent = "claude" | "codex";

/** The coding agent a commit was co-authored with, read from its `Co-authored-by:` names. */
export function coAgentOf(coAuthors: string[]): CoAgent | null {
  if (coAuthors.some((name) => /claude/i.test(name))) return "claude";
  if (coAuthors.some((name) => /codex|openai|copilot/i.test(name))) return "codex";
  return null;
}

/** The agent's mark on a round badge, for the corner of an author's avatar. */
export function AgentBadge({ agent, className }: { agent: CoAgent; className?: string }) {
  const Icon = agent === "claude" ? ClaudeIcon : CodexIcon;
  return (
    <span
      className={cn(
        "grid place-items-center rounded-full ring-2 ring-panel",
        agent === "claude" ? "bg-[#d97757] text-white" : "bg-foreground text-background",
        className,
      )}
    >
      <Icon className="size-[70%]" />
    </span>
  );
}
