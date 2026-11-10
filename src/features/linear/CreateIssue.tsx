import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useInstalledAgents } from "@/features/agents/use-agents";
import { useT, type MessageKey } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useAgentsStore } from "@/stores/agents-store";
import { useLinearStore } from "@/stores/linear-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentKind } from "@/types/git";
import { useActiveAccount, useLinearAccounts, useOpenProject } from "./linear-queries";
import { startIssueAgent } from "./issue-agent";

const PRIORITIES: { value: number; label: MessageKey }[] = [
  { value: 0, label: "linear.prio.none" },
  { value: 1, label: "linear.prio.urgent" },
  { value: 2, label: "linear.prio.high" },
  { value: 3, label: "linear.prio.medium" },
  { value: 4, label: "linear.prio.low" },
];

const DEFAULT_STATE = "default";
type AfterCreate = "open" | AgentKind;

function useTeams(orgId: string | null) {
  return useQuery({
    queryKey: ["linear", "states", orgId],
    queryFn: () => gitBackend.linearTeamStates(orgId ?? ""),
    enabled: !!orgId,
    staleTime: 10 * 60_000,
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

type IssueDraft = { title: string; description: string };

function CreateForm({ onDone, initial }: { onDone: () => void; initial?: IssueDraft }) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const accounts = useLinearAccounts().data ?? [];
  const active = useActiveAccount();
  const [orgId, setOrgId] = useState(active?.id ?? accounts[0]?.id ?? null);
  const teams = useTeams(orgId).data ?? [];
  const lastTeam = useLinearStore((s) => s.lastTeam);
  const [teamId, setTeamId] = useState<string | null>(null);
  const team = teams.find((x) => x.id === teamId) ?? teams.find((x) => x.id === lastTeam) ?? teams[0];
  const [stateId, setStateId] = useState(DEFAULT_STATE);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState(0);
  const [assignToMe, setAssignToMe] = useState(true);
  const installed = useInstalledAgents().data ?? [];
  const preferred = useAgentsStore((s) => s.preferredAgent);
  const agents = (["claude", "codex"] as const).filter((k) => installed.find((a) => a.kind === k)?.installed);
  const [after, setAfter] = useState<AfterCreate>("open");
  const repoPath = useWorkspaceStore((s) => s.repo?.path ?? null);
  // Created from a project's board: the issue goes into that project.
  const project = useOpenProject();
  const projectId = project && project.orgId === orgId ? project.id : null;

  const create = useMutation({
    mutationFn: () =>
      gitBackend.linearCreateIssue(orgId ?? "", {
        teamId: team?.id ?? "",
        title: title.trim(),
        description,
        priority,
        stateId: stateId === DEFAULT_STATE ? null : stateId,
        assignToMe,
        projectId,
      }),
    onSuccess: async (issue) => {
      useLinearStore.setState({ lastTeam: team?.id ?? null });
      void client.invalidateQueries({ queryKey: ["linear", "issues", orgId] });
      void client.invalidateQueries({ queryKey: ["linear", "project-issues", orgId] });
      notify({ tone: "success", title: t("linear.created", { id: issue.identifier }) });
      onDone();
      if (after !== "open" && repoPath) {
        await startIssueAgent(repoPath, after, issue);
      } else if (orgId) {
        useLinearStore.getState().setIssue(issue.id, orgId);
        useWorkspaceStore.getState().setView("linear");
      }
    },
    onError: (error) => notify({ tone: "error", title: t("linear.createFailed"), detail: toGitError(error).message }),
  });
  const states = [...(team?.states.nodes ?? [])].sort((a, b) => a.position - b.position);
  const ready = !!orgId && !!team && title.trim().length > 0 && !create.isPending;

  return (
    <form
      className="flex min-w-0 flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) create.mutate();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        {accounts.length > 1 && (
          <Field label={t("linear.workspace")}>
            <Select
              value={orgId ?? undefined}
              onValueChange={(v) => {
                setOrgId(v);
                setTeamId(null);
                setStateId(DEFAULT_STATE);
              }}
            >
              <SelectTrigger size="sm" className="h-7 w-40 text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-[12.5px]">
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label={t("linear.team")}>
          <Select
            value={team?.id}
            onValueChange={(v) => {
              setTeamId(v);
              setStateId(DEFAULT_STATE);
            }}
          >
            <SelectTrigger size="sm" className="h-7 w-44 text-[12.5px]" aria-label={t("linear.team")}>
              <SelectValue placeholder={t("common.loading")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {teams.map((x) => (
                <SelectItem key={x.id} value={x.id} className="text-[12.5px]">
                  <span className="font-mono text-muted-foreground">{x.key}</span> {x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("linear.status")}>
          <Select value={stateId} onValueChange={setStateId}>
            <SelectTrigger size="sm" className="h-7 w-48 text-[12.5px]" aria-label={t("linear.status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={DEFAULT_STATE} className="text-[12.5px]">
                {t("linear.defaultStatus")}
              </SelectItem>
              {states.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-[12.5px]">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("linear.priority")}>
          <Select value={String(priority)} onValueChange={(v) => setPriority(Number(v))}>
            <SelectTrigger size="sm" className="h-7 w-40 text-[12.5px]" aria-label={t("linear.priority")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p.value} value={String(p.value)} className="text-[12.5px]">
                  {t(p.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Input
        autoFocus
        aria-label={t("linear.issueTitle")}
        placeholder={t("linear.issueTitle")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-[14px] font-medium"
      />
      <Textarea
        aria-label={t("linear.issueDescription")}
        placeholder={t("linear.issueDescriptionHint")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey && ready) create.mutate();
        }}
        className="min-h-36 resize-y text-[13px] md:text-[13px]"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Checkbox checked={assignToMe} onCheckedChange={(v) => setAssignToMe(v === true)} />
          {t("linear.assignToMe")}
        </label>
        {agents.length > 0 && (
          <div role="radiogroup" aria-label={t("linear.afterCreate")} className="flex rounded-md bg-white/[0.05] p-0.5">
            {(["open", ...agents.sort((a) => (a === preferred ? -1 : 1))] as AfterCreate[]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={after === option}
                onClick={() => setAfter(option)}
                className={cn(
                  "h-6 rounded-[5px] px-2.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  after === option
                    ? "bg-white/[0.12] text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "open"
                  ? t("linear.justCreate")
                  : t("linear.startWith", { agent: option === "claude" ? "Claude Code" : "Codex" })}
              </button>
            ))}
          </div>
        )}
        <Button type="submit" size="sm" disabled={!ready} className="ml-auto gap-1.5">
          {create.isPending && <BrailleLoader />}
          {t("linear.create")}
          <kbd className="text-[11px] opacity-70">⌘↵</kbd>
        </Button>
      </div>
    </form>
  );
}

/** "New issue" in Linear, optionally handed straight to an agent. */
export function CreateIssueButton({ variant = "icon" }: { variant?: "icon" | "header" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const connected = (useLinearAccounts().data ?? []).length > 0;
  // Linear's shortcut: C creates an issue, from the board (not while typing).
  useEffect(() => {
    if (variant !== "header" || !connected) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable=true]");
      if (e.key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, connected]);
  if (!connected) return null;
  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          aria-label={t("linear.newIssue")}
          title={t("linear.newIssue")}
          onClick={() => setOpen(true)}
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="h-7 gap-1.5 text-[12.5px]">
          <Plus aria-hidden className="size-3.5" />
          {t("linear.newIssue")}
          <kbd className="kbd text-[11px]">C</kbd>
        </Button>
      )}
      <CreateIssueDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** The new-issue form in a dialog, optionally prefilled (from a code comment, for instance). */
export function CreateIssueDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: IssueDraft;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-4 rounded-xl sm:max-w-[640px]">
        <DialogTitle className="text-[15px]">{t("linear.newIssue")}</DialogTitle>
        {open && <CreateForm onDone={() => onOpenChange(false)} initial={initial} />}
      </DialogContent>
    </Dialog>
  );
}
