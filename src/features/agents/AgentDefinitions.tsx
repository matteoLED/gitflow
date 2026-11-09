import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Plus, Trash2 } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { PanelHeader } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useAgentsStore } from "@/stores/agents-store";
import { useNoticesStore } from "@/stores/notices-store";
import type { AgentDefinition, AgentScope } from "@/types/git";

const key = (repoPath: string) => ["agent-definitions", repoPath];

export function useAgentDefinitions(repoPath: string) {
  return useQuery({ queryKey: key(repoPath), queryFn: () => gitBackend.listAgentDefinitions(repoPath) });
}

const MODELS = ["inherit", "opus", "sonnet", "haiku", "fable"] as const;

/** The Claude Code sub-agents of this project and of the user, in the Agents list. */
export function AgentDefinitionsSection({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  const defs = useAgentDefinitions(repoPath).data ?? [];
  const { selection, select } = useAgentsStore();
  const needle = query.toLowerCase();
  const shown = defs.filter((d) => `${d.name} ${d.description}`.toLowerCase().includes(needle));
  const isSelected = (d: AgentDefinition) =>
    selection.type === "definition" && selection.name === d.name && selection.scope === d.scope;
  return (
    <li className="mb-1.5">
      <p className="mt-1 flex h-7 items-center gap-1.5 px-2 text-[11.5px] font-medium text-muted-foreground">
        {t("agentDefs.title")}
        <span>{shown.length}</span>
        <button
          type="button"
          aria-label={t("agentDefs.new")}
          title={t("agentDefs.new")}
          onClick={() => select({ type: "new-definition" })}
          className="ml-auto grid size-5 place-items-center rounded hover:bg-white/[0.08] hover:text-foreground"
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
      </p>
      <ul className="mt-0.5">
        {shown.map((d) => (
          <li key={`${d.scope}:${d.name}`}>
            <button
              type="button"
              onClick={() => select({ type: "definition", scope: d.scope, name: d.name })}
              className={cn(
                "grid w-full grid-cols-[14px_1fr_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring",
                isSelected(d) && "bg-white/[0.08]",
              )}
            >
              <Bot aria-hidden className="size-3.5 text-primary" />
              <span className="truncate font-mono text-[12.5px]">{d.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {d.scope === "project" ? t("agentDefs.project") : t("agentDefs.user")}
              </span>
              <span className="col-start-2 col-end-4 truncate text-[11.5px] text-muted-foreground">
                {d.description}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-[12.5px]">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

const blank: AgentDefinition = { name: "", description: "", model: "inherit", tools: "", prompt: "", scope: "project" };

/** Creates or edits a sub-agent: its file under `.claude/agents/`, which Claude Code picks up by itself. */
export function AgentDefinitionEditor({
  repoPath,
  target,
}: {
  repoPath: string;
  target: { scope: AgentScope; name: string } | null;
}) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const select = useAgentsStore((s) => s.select);
  const existing = useAgentDefinitions(repoPath).data?.find(
    (d) => target && d.name === target.name && d.scope === target.scope,
  );
  const [draft, setDraft] = useState<AgentDefinition>(() =>
    existing ? { ...existing, model: existing.model || "inherit" } : blank,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<AgentDefinition>) => setDraft((d) => ({ ...d, ...patch }));
  const done = (scope: AgentScope, name: string) => {
    void client.invalidateQueries({ queryKey: key(repoPath) });
    select({ type: "definition", scope, name });
  };
  const save = useMutation({
    mutationFn: () =>
      gitBackend.saveAgentDefinition(
        repoPath,
        { ...draft, model: draft.model === "inherit" ? "" : draft.model },
        existing && existing.scope === draft.scope ? existing.name : null,
      ),
    onSuccess: () => {
      notify({ tone: "success", title: t("agentDefs.saved", { name: draft.name }) });
      done(draft.scope, draft.name);
    },
    onError: (error) => notify({ tone: "error", title: t("agentDefs.saveFailed"), detail: toGitError(error).message }),
  });
  const remove = useMutation({
    mutationFn: () => gitBackend.deleteAgentDefinition(repoPath, existing?.scope ?? "project", existing?.name ?? ""),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key(repoPath) });
      select({ type: "new" });
    },
    onError: (error) =>
      notify({ tone: "error", title: t("agentDefs.deleteFailed"), detail: toGitError(error).message }),
  });
  const valid = /^[a-z0-9][a-z0-9-]{0,63}$/.test(draft.name) && draft.description.trim().length > 0;
  const path = `${draft.scope === "project" ? ".claude" : "~/.claude"}/agents/${draft.name || "…"}.md`;
  return (
    <>
      <PanelHeader className="gap-2">
        <Bot aria-hidden className="size-3.5 text-primary" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {existing ? existing.name : t("agentDefs.new")}
        </h2>
        <span className="font-mono text-[11.5px] text-muted-foreground">{path}</span>
      </PanelHeader>
      <form
        className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
        onKeyDown={(e) => {
          if (e.key === "s" && e.metaKey && valid) {
            e.preventDefault();
            save.mutate();
          }
        }}
      >
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          <div className="grid grid-cols-[1fr_auto_auto] items-start gap-3">
            <Field label={t("agentDefs.name")} hint={t("agentDefs.nameHint")}>
              <Input
                autoFocus={!existing}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
                placeholder="code-reviewer"
                className="font-mono"
              />
            </Field>
            <Field label={t("agentDefs.scope")}>
              <Select value={draft.scope} onValueChange={(v: AgentScope) => set({ scope: v })}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">{t("agentDefs.project")}</SelectItem>
                  <SelectItem value="user">{t("agentDefs.user")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("agentDefs.model")}>
              <Select value={draft.model || "inherit"} onValueChange={(v) => set({ model: v })}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...MODELS, draft.model || "inherit"])].map((m) => (
                    <SelectItem key={m} value={m}>
                      {m === "inherit" ? t("agentDefs.inherit") : m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t("agentDefs.description")} hint={t("agentDefs.descriptionHint")}>
            <Input
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder={t("agentDefs.descriptionPlaceholder")}
            />
          </Field>
          <Field label={t("agentDefs.tools")} hint={t("agentDefs.toolsHint")}>
            <Input
              value={draft.tools}
              onChange={(e) => set({ tools: e.target.value })}
              placeholder="Read, Grep, Glob, Bash"
              className="font-mono"
            />
          </Field>
          <Field label={t("agentDefs.prompt")} hint={t("agentDefs.promptHint")}>
            <Textarea
              value={draft.prompt}
              onChange={(e) => set({ prompt: e.target.value })}
              placeholder={t("agentDefs.promptPlaceholder")}
              className="min-h-72 resize-y font-mono text-[12.5px] md:text-[12.5px]"
            />
          </Field>
          <div className="flex items-center gap-2">
            {existing &&
              (confirmDelete ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                  className="gap-1.5"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                  {t("agentDefs.confirmDelete")}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(true)}
                  className="gap-1.5 text-muted-foreground"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                  {t("agentDefs.delete")}
                </Button>
              ))}
            <Button type="submit" size="sm" disabled={!valid || save.isPending} className="ml-auto gap-1.5">
              {save.isPending && <BrailleLoader />}
              {existing ? t("agentDefs.save") : t("agentDefs.create")}
              <kbd className="text-[11px] opacity-70">⌘S</kbd>
            </Button>
          </div>
          <p className="text-[12px] text-muted-foreground">{t("agentDefs.howUsed")}</p>
        </div>
      </form>
    </>
  );
}
