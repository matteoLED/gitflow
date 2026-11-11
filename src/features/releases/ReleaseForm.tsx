import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Wand2, X } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { pickAgent } from "@/features/agents/AgentButton";
import { startAgentRun, useInstalledAgents } from "@/features/agents/use-agents";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo, useRefs } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { finalAnswer, useAgentsStore } from "@/stores/agents-store";
import { useNoticesStore } from "@/stores/notices-store";
import type { AgentKind, Release, ReleaseInput } from "@/types/git";
import { releasesKey, useTags } from "./release-queries";
import { latestVersionTag, nextVersions, type Bump } from "./semver";
import { plausibleTagName } from "./TagDialog";

const AUTO = "__auto__";
const BUMPS: Bump[] = ["patch", "minor", "major"];
const LABEL = "text-[12px] font-medium text-muted-foreground";

/** What the read-only agent is asked: a user-facing changelog from the commits (and PRs) of the range. */
export function changelogPrompt(from: string | null, to: string, commits: string): string {
  return [
    `Write a user-facing changelog for the release ${to}${from ? ` (changes since ${from})` : ""}.`,
    "Group entries under Markdown headings (Features, Fixes, Improvements; skip empty ones), one short line each, written for users rather than developers, and mention pull request numbers like (#123) when known. Leave out purely internal changes (CI, refactors, dependency bumps) unless users notice them.",
    "You may read pull requests with read-only commands such as `gh pr view <number>`. Do not change anything.",
    "Answer with the changelog Markdown only, no preamble.",
    `Commits in the range:\n${commits.trim() || "(none)"}`,
  ].join("\n\n");
}

/** The AI changelog's run: progress, then its answer to put into the notes. */
function AiChangelog({ runId, onUse, onClose }: { runId: string; onUse: (text: string) => void; onClose: () => void }) {
  const t = useT();
  const run = useAgentsStore((s) => s.runs.find((r) => r.id === runId));
  const answer = run && run.status === "done" ? finalAnswer(run) : null;
  return (
    <div className="surface flex flex-col gap-2 px-3 py-2.5">
      <p className="flex items-center gap-2 text-[12.5px] font-medium">
        <Sparkles aria-hidden className="size-3.5 text-primary" />
        {t("releases.aiChangelog")}
        <button
          type="button"
          aria-label={t("common.dismiss")}
          onClick={() => {
            if (run?.status === "running") void gitBackend.cancelAgentRun(runId);
            onClose();
          }}
          className="ml-auto grid size-5 place-items-center rounded text-muted-foreground hover:bg-white/[0.07]"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </p>
      {!run || run.status === "running" ? (
        <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <BrailleLoader className="text-primary" />
          <span className="truncate">{run?.steps.at(-1)?.title ?? t("common.loading")}</span>
        </p>
      ) : answer ? (
        <>
          <pre className="max-h-64 overflow-y-auto font-sans text-[12.5px] whitespace-pre-wrap">{answer}</pre>
          <Button size="xs" variant="outline" className="self-start" onClick={() => onUse(answer)}>
            {t("releases.useChangelog")}
          </Button>
        </>
      ) : (
        <p className="text-[12px] text-muted-foreground">{t("releases.aiFailed")}</p>
      )}
    </div>
  );
}

/** Starts the read-only agent on the range's commits; resolves to its run id, or null (already notified). */
async function startChangelog(repoPath: string, agent: AgentKind, from: string | null, to: string, title: string) {
  const commits = await gitBackend.releaseCommits(repoPath, from, to);
  const task = { kind: "custom" as const, prompt: changelogPrompt(from, to, commits) };
  return startAgentRun(repoPath, agent, task, title, undefined, [], undefined, undefined, undefined, true);
}

/** Create or edit a release: tag (with semver suggestions), target, notes, draft and prerelease. */
export function ReleaseForm({
  repoPath,
  release,
  initialTag,
  onDone,
}: {
  repoPath: string;
  release?: Release;
  initialTag: string | null;
  onDone: (release: Release | null) => void;
}) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const tagsId = useId();
  const tagNames = (useTags(repoPath).data ?? []).map((tag) => tag.name);
  const branch = useRefs(repoPath).data?.head.branch ?? "";
  const suggestions = nextVersions(tagNames);
  const agent = pickAgent(
    useInstalledAgents().data,
    useAgentsStore((s) => s.preferredAgent),
  );
  const [tag, setTag] = useState(initialTag ?? suggestions.patch);
  const [target, setTarget] = useState(release?.target_commitish ?? branch);
  const [previous, setPrevious] = useState(AUTO);
  const [name, setName] = useState(release?.name ?? initialTag ?? "");
  const [body, setBody] = useState(release?.body ?? "");
  const [draft, setDraft] = useState(release?.draft ?? false);
  const [prerelease, setPrerelease] = useState(release?.prerelease ?? false);
  const [aiRun, setAiRun] = useState<string | null>(null);
  const trimmedTag = tag.trim();
  const localTag = tagNames.includes(trimmedTag);
  const others = tagNames.filter((n) => n !== trimmedTag);
  const from = previous === AUTO ? latestVersionTag(others) : previous;
  const fail = (title: string) => (error: unknown) =>
    notify({ tone: "error", title, detail: toGitError(error).message });

  const save = useMutation({
    mutationFn: async () => {
      // A local tag is pushed first: otherwise GitHub would create its own tag of that name on `target`.
      if (localTag && !release) await gitBackend.pushTag(repoPath, trimmedTag);
      const input: ReleaseInput = {
        tagName: trimmedTag,
        target: localTag ? null : target.trim() || null,
        name: name.trim() || trimmedTag,
        body,
        draft,
        prerelease,
      };
      return release
        ? gitBackend.updateRelease(repoPath, release.id, input)
        : gitBackend.createRelease(repoPath, input);
    },
    onSuccess: (saved) => {
      notify({ tone: "success", title: t(release ? "releases.saved" : "releases.created", { name: saved.tag_name }) });
      void client.invalidateQueries({ queryKey: releasesKey(repoPath) });
      void invalidateRepo(client, repoPath);
      onDone(saved);
    },
    onError: fail(t("releases.failed")),
  });
  const generate = useMutation({
    mutationFn: () =>
      gitBackend.generateReleaseNotes(repoPath, trimmedTag, from, localTag ? null : target.trim() || null),
    onSuccess: (notes) => {
      setBody(notes.body);
      if (!name.trim()) setName(notes.name);
    },
    onError: fail(t("releases.generateFailed")),
  });
  const ai = useMutation({
    mutationFn: async () => {
      if (!agent) return null;
      const to = localTag ? trimmedTag : target.trim() || "HEAD";
      return startChangelog(repoPath, agent, from, to, t("releases.aiRunTitle", { tag: trimmedTag }));
    },
    onSuccess: (id) => id && setAiRun(id),
    onError: fail(t("releases.aiFailed")),
  });
  const valid = plausibleTagName(trimmedTag);

  return (
    <form
      className="min-h-0 flex-1 overflow-y-auto px-8 pt-8 pb-12"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <div className="mx-auto flex max-w-[760px] flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>{t("releases.tag")}</span>
            <Input
              list={tagsId}
              aria-invalid={!valid && tag !== ""}
              disabled={!!release}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="font-mono text-[13px]"
            />
            <datalist id={tagsId}>
              {tagNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>{t("releases.target")}</span>
            <Input
              disabled={localTag || !!release}
              value={localTag ? t("releases.tagExists") : target}
              onChange={(e) => setTarget(e.target.value)}
              className="font-mono text-[13px]"
            />
          </label>
        </div>
        {!release && (
          <div className="flex flex-wrap gap-1.5">
            {BUMPS.map((bump) => (
              <Button key={bump} type="button" size="xs" variant="outline" onClick={() => setTag(suggestions[bump])}>
                {t(`tags.${bump}`)} <span className="font-mono">{suggestions[bump]}</span>
              </Button>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>{t("releases.name")}</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={trimmedTag}
            className="text-[14px]"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className={LABEL}>{t("releases.since")}</span>
          <Select value={previous} onValueChange={setPrevious}>
            <SelectTrigger size="sm" aria-label={t("releases.since")} className="h-7 w-44 font-mono text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={AUTO} className="text-[12.5px]">
                {t("releases.sinceAuto", { tag: from ?? "—" })}
              </SelectItem>
              {others.map((n) => (
                <SelectItem key={n} value={n} className="font-mono text-[12.5px]">
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!valid || generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? <BrailleLoader /> : <Wand2 aria-hidden />}
            {t("releases.generate")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!valid || !agent || ai.isPending || aiRun !== null}
            title={agent ? undefined : t("releases.noAgent")}
            onClick={() => ai.mutate()}
          >
            <Sparkles aria-hidden />
            {t("releases.aiChangelog")}
          </Button>
        </div>
        {aiRun && (
          <AiChangelog
            runId={aiRun}
            onClose={() => setAiRun(null)}
            onUse={(text) => {
              setBody((current) => (current.trim() ? `${current.trimEnd()}\n\n${text}` : text));
              setAiRun(null);
            }}
          />
        )}
        <Textarea
          aria-label={t("releases.notes")}
          placeholder={t("releases.notesPlaceholder")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-64 resize-y font-mono text-[12.5px] md:text-[12.5px]"
        />
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Checkbox checked={draft} onCheckedChange={(v) => setDraft(v === true)} />
            {t("releases.draft")}
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Checkbox checked={prerelease} onCheckedChange={(v) => setPrerelease(v === true)} />
            {t("releases.prerelease")}
          </label>
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => onDone(null)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={!valid || save.isPending}>
            {save.isPending && <BrailleLoader />}
            {release ? t("common.save") : draft ? t("releases.saveDraft") : t("releases.publish")}
          </Button>
        </div>
      </div>
    </form>
  );
}
