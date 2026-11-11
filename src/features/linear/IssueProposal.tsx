import { lazy, Suspense, useState } from "react";
import type { Components } from "react-markdown";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { LinearIcon } from "./LinearIcon";

// The form (and Linear's queries) only load when an issue is actually created from a reply.
const CreateIssueDialog = lazy(() => import("./CreateIssue").then((m) => ({ default: m.CreateIssueDialog })));

// Already loaded once a reply shows: the card itself lives inside the agent's Markdown.
const Markdown = lazy(() => import("@/features/agents/Markdown"));

export type ProposedIssue = { title: string; description: string };

/** The JSON of a `linear-issue` block, or null while it streams in or when it isn't one. */
export function parseProposal(text: string): ProposedIssue | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const { title, description } = value as Record<string, unknown>;
    if (typeof title !== "string" || !title.trim()) return null;
    return { title: title.trim().slice(0, 255), description: typeof description === "string" ? description : "" };
  } catch {
    return null;
  }
}

type Hast = { type: string; value?: string; tagName?: string; properties?: { className?: unknown }; children?: Hast[] };
const textOf = (node: Hast): string => node.value ?? (node.children ?? []).map(textOf).join("");

/** Markdown `pre` that turns an agent's ```linear-issue block into a card; any other block renders as usual. */
export const proposalPre: Components["pre"] = ({ node, children, ...rest }) => {
  const code = (node as Hast | undefined)?.children?.[0];
  const classes = code?.properties?.className;
  const isProposal = code?.tagName === "code" && Array.isArray(classes) && classes.includes("language-linear-issue");
  const issue = isProposal && code ? parseProposal(textOf(code)) : null;
  return issue ? <IssueProposal issue={issue} /> : <pre {...rest}>{children}</pre>;
};

function IssueProposal({ issue }: { issue: ProposedIssue }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="not-prose my-2 rounded-lg border border-white/[0.08] bg-white/[0.03]">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <LinearIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        {/* The draft opens in place: the full description, as it will read in Linear. */}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="group min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium text-foreground">{issue.title}</span>
            <span className="rounded bg-white/[0.07] px-1 py-px text-[10.5px] text-muted-foreground">
              {t("linear.draft")}
            </span>
            <ChevronRight
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground",
                expanded && "rotate-90",
              )}
            />
          </span>
          {issue.description && !expanded && (
            <span className="mt-0.5 line-clamp-2 block text-[12px] text-muted-foreground">{issue.description}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-white/[0.08] px-2 text-[12px] text-foreground outline-none hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus aria-hidden className="size-3.5" />
          {t("linear.createProposed")}
        </button>
      </div>
      {expanded && (
        <div className="max-h-96 overflow-y-auto border-t border-white/[0.06] px-3 py-2.5 pl-9 text-[12.5px]">
          {issue.description ? (
            <Suspense fallback={<p className="whitespace-pre-wrap">{issue.description}</p>}>
              <Markdown text={issue.description} />
            </Suspense>
          ) : (
            <p className="text-muted-foreground">{t("linear.noDescription")}</p>
          )}
        </div>
      )}
      {open && (
        <Suspense fallback={null}>
          <CreateIssueDialog open onOpenChange={setOpen} initial={issue} />
        </Suspense>
      )}
    </div>
  );
}
