import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequestArrow } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo, repoKey, useCommits, useRefs } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";

/** How far HEAD is past the default branch (or `base`); refreshed with the repository. */
export function useBaseComparison(repoPath: string, base: string | null = null) {
  return useQuery({
    queryKey: [...repoKey(repoPath), "compare-base", base],
    queryFn: () => gitBackend.compareWithBase(repoPath, base),
  });
}

/** "mat/fix-email-count" → "Fix email count". */
export function titleFromBranch(branch: string): string {
  const words = branch
    .slice(branch.lastIndexOf("/") + 1)
    .replace(/[-_]+/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function CreateForm({
  repoPath,
  branch,
  published,
  defaultBase,
  initialAhead,
  onDone,
}: {
  repoPath: string;
  branch: string;
  published: boolean;
  defaultBase: string;
  initialAhead: number;
  onDone: () => void;
}) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const refs = useRefs(repoPath).data;
  const [base, setBase] = useState(defaultBase);
  const ahead = useBaseComparison(repoPath, base).data?.ahead ?? initialAhead;
  const recent = useCommits(repoPath, null).data?.pages[0] ?? [];
  const commits = recent.slice(0, initialAhead);
  // Prefilled like GitHub: one commit gives its subject, several give the branch name and a list.
  const [title, setTitle] = useState(() =>
    initialAhead === 1 && commits[0] ? commits[0].subject : titleFromBranch(branch),
  );
  const [body, setBody] = useState(() => (initialAhead > 1 ? commits.map((c) => `- ${c.subject}`).join("\n") : ""));
  const [draft, setDraft] = useState(false);
  const create = useMutation({
    mutationFn: async () => {
      if (!published) await gitBackend.push(repoPath);
      return gitBackend.createPullRequest(repoPath, base, title, body, draft);
    },
    onSuccess: (url) => {
      notify({ tone: "success", title: t("createPr.created"), detail: url || undefined });
      void invalidateRepo(client, repoPath);
      onDone();
    },
    onError: (error) => notify({ tone: "error", title: t("createPr.failed"), detail: toGitError(error).message }),
  });
  const bases = [...new Set([defaultBase, ...(refs?.branches.map((b) => b.name) ?? [])])].filter((b) => b !== branch);
  return (
    <form
      className="flex min-w-0 flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) create.mutate();
      }}
    >
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="min-w-0 truncate font-mono text-foreground">{branch}</span>→
        <Select value={base} onValueChange={setBase}>
          <SelectTrigger
            size="sm"
            aria-label={t("createPr.base")}
            className="h-7 w-44 shrink-0 font-mono text-[12.5px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {bases.map((b) => (
              <SelectItem key={b} value={b} className="font-mono text-[12.5px]">
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto shrink-0">{t.plural("createPr.ahead", ahead)}</span>
      </div>
      <Input
        autoFocus
        aria-label={t("createPr.title")}
        placeholder={t("createPr.title")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-[14px] font-medium"
      />
      <Textarea
        aria-label={t("createPr.body")}
        placeholder={t("createPr.bodyPlaceholder")}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="min-h-40 resize-y text-[13px] md:text-[13px]"
      />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Checkbox checked={draft} onCheckedChange={(v) => setDraft(v === true)} />
          {t("createPr.draft")}
        </label>
        {!published && <span className="text-[12px] text-muted-foreground">{t("createPr.willPublish")}</span>}
        <Button type="submit" size="sm" disabled={!title.trim() || ahead === 0 || create.isPending} className="ml-auto">
          {create.isPending && <BrailleLoader />}
          {draft ? t("createPr.createDraft") : t("createPr.create")}
        </Button>
      </div>
    </form>
  );
}

/** "Create pull request" for a branch that is past its base and has no PR yet. */
export function CreatePullRequestButton({
  repoPath,
  branch,
  published,
  base,
  ahead,
}: {
  repoPath: string;
  branch: string;
  published: boolean;
  base: string;
  ahead: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)} className="gap-1">
        <GitPullRequestArrow aria-hidden />
        {t("createPr.open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] gap-4 rounded-xl sm:max-w-[600px]">
          <DialogTitle className="text-[15px]">{t("createPr.heading")}</DialogTitle>
          {open && (
            <CreateForm
              repoPath={repoPath}
              branch={branch}
              published={published}
              defaultBase={base}
              initialAhead={ahead}
              onDone={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
