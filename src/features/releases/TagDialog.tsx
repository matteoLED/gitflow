import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import { useTags } from "./release-queries";
import { nextVersions, type Bump } from "./semver";

const BUMPS: Bump[] = ["patch", "minor", "major"];

/** Obvious mistakes caught as you type; git's own check-ref-format has the last word. */
export const plausibleTagName = (name: string) => name.length > 0 && !name.startsWith("-") && !/\s/.test(name);

function TagForm({
  repoPath,
  target,
  onDone,
}: {
  repoPath: string;
  target: { hash: string; label: string } | null;
  onDone: () => void;
}) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const suggestions = nextVersions((useTags(repoPath).data ?? []).map((tag) => tag.name));
  const [name, setName] = useState(suggestions.patch);
  const [annotated, setAnnotated] = useState(true);
  const [message, setMessage] = useState("");
  const [push, setPush] = useState(false);
  const create = useMutation({
    mutationFn: async () => {
      const tag = name.trim();
      await gitBackend.createTag(repoPath, tag, target?.hash ?? null, annotated ? message || tag : null);
      if (push) await gitBackend.pushTag(repoPath, tag);
    },
    onSuccess: () => {
      notify({ tone: "success", title: t(push ? "tags.createdPushed" : "tags.created", { name: name.trim() }) });
      onDone();
    },
    onError: (error) => notify({ tone: "error", title: t("tags.createFailed"), detail: toGitError(error).message }),
    onSettled: () => invalidateRepo(client, repoPath),
  });
  const valid = plausibleTagName(name.trim());
  return (
    <form
      className="flex min-w-0 flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) create.mutate();
      }}
    >
      <p className="text-[12.5px] text-muted-foreground">
        {t("tags.on")} <span className="font-mono text-foreground">{target?.label ?? "HEAD"}</span>
      </p>
      <Input
        autoFocus
        aria-label={t("tags.name")}
        aria-invalid={!valid && name !== ""}
        placeholder="v1.0.0"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="font-mono text-[13px]"
      />
      <div className="flex flex-wrap gap-1.5">
        {BUMPS.map((bump) => (
          <Button key={bump} type="button" size="xs" variant="outline" onClick={() => setName(suggestions[bump])}>
            {t(`tags.${bump}`)} <span className="font-mono">{suggestions[bump]}</span>
          </Button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <Checkbox checked={annotated} onCheckedChange={(v) => setAnnotated(v === true)} />
        {t("tags.annotated")}
      </label>
      {annotated && (
        <Textarea
          aria-label={t("tags.message")}
          placeholder={t("tags.messagePlaceholder")}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="min-h-24 resize-y text-[13px] md:text-[13px]"
        />
      )}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Checkbox checked={push} onCheckedChange={(v) => setPush(v === true)} />
          {t("tags.pushAfter")}
        </label>
        <Button type="submit" size="sm" disabled={!valid || create.isPending} className="ml-auto">
          {create.isPending && <BrailleLoader />}
          {t("tags.create")}
        </Button>
      </div>
    </form>
  );
}

/** New tag on `target` (HEAD when null), lightweight or annotated, optionally pushed. */
export function TagDialog({
  repoPath,
  target,
  open,
  onOpenChange,
}: {
  repoPath: string;
  target: { hash: string; label: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-4 rounded-xl sm:max-w-[480px]">
        <DialogTitle className="text-[15px]">{t("tags.heading")}</DialogTitle>
        {open && <TagForm repoPath={repoPath} target={target} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
