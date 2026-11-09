import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Cloud, GitBranch } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n";
import { useRefs } from "@/lib/git-queries";
import { cn } from "@/lib/utils";
import { useCheckout, type CheckoutTarget } from "./use-checkout";

const MAX_SHOWN = 200;

/** The checked-out branch, always in sight; click to switch to any local or remote branch (GitKraken-style). */
export function BranchSwitcher({ repoPath }: { repoPath: string }) {
  const t = useT();
  const refs = useRefs(repoPath).data;
  const checkout = useCheckout(repoPath);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = refs?.head.branch ?? null;
  const targets = useMemo(() => {
    if (!refs) return [];
    const locals = new Set(refs.branches.map((b) => b.name));
    const needle = query.toLowerCase();
    const all: CheckoutTarget[] = [
      ...refs.branches.map((b) => ({ kind: "local" as const, name: b.name })),
      // A remote branch already checked out locally is reached through its local one.
      ...refs.remotes
        .filter((r) => r.name !== "HEAD" && !locals.has(r.name))
        .map((r) => ({ kind: "remote" as const, name: `${r.remote}/${r.name}` })),
    ];
    return all.filter((target) => target.name.toLowerCase().includes(needle)).slice(0, MAX_SHOWN);
  }, [refs, query]);
  const pick = (target: CheckoutTarget) => {
    setOpen(false);
    setQuery("");
    if (target.kind === "local" && target.name === current) return;
    checkout.mutate(target);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="mx-2 mb-2 flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-md border border-white/[0.07] px-2 text-left text-[12.5px] outline-none hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/[0.06]"
        aria-label={t("branches.switcher")}
      >
        {checkout.isPending ? (
          <BrailleLoader className="text-primary" />
        ) : (
          <GitBranch aria-hidden className="size-3.5 shrink-0 text-primary" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{current ?? t("changes.detached")}</span>
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-80 overflow-hidden rounded-xl p-0">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && targets[0] && pick(targets[0])}
          placeholder={t("branches.switchPlaceholder")}
          aria-label={t("branches.switchPlaceholder")}
          className="h-9 w-full border-b border-white/[0.06] bg-transparent px-3 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <ul className="max-h-80 overflow-y-auto p-1">
          {targets.map((target) => (
            <li key={`${target.kind}:${target.name}`}>
              <button
                type="button"
                onClick={() => pick(target)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] outline-none hover:bg-white/[0.06] focus-visible:bg-white/[0.06]"
              >
                {target.kind === "remote" ? (
                  <Cloud aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <GitBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-mono text-[12px]",
                    target.kind === "remote" && "text-muted-foreground",
                  )}
                >
                  {target.name}
                </span>
                {target.kind === "local" && target.name === current && (
                  <Check aria-hidden className="size-3.5 shrink-0 text-primary" />
                )}
              </button>
            </li>
          ))}
          {targets.length === 0 && (
            <li className="px-2 py-1.5 text-[12.5px] text-muted-foreground">{t("branches.noMatch")}</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
