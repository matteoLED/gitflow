import { useEffect, type ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown, Copy, Ellipsis, ExternalLink, Link, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { useGithubWebUrl } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import { reviewKey, useReviewStore } from "@/stores/review-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ChangedFile } from "@/types/git";

const ITEM = "h-7 gap-2 px-2 text-[13px] [&_svg]:size-3.5 [&_svg]:text-muted-foreground";

type FileActionsProps = {
  repoPath: string;
  /** Commit the file is shown at; for a deleted file, its content lives at `base` (or the parent). */
  hash: string;
  base: string | null;
  file: ChangedFile;
  open: boolean;
  onToggleOpen: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** ⌥E applies to the selected file only. */
  selected: boolean;
};

function useCopy() {
  const t = useT();
  const notify = useNoticesStore((s) => s.notify);
  return async (text: string | Promise<string>) => {
    try {
      await navigator.clipboard.writeText(await text);
      notify({ tone: "success", title: t("file.copied") });
    } catch (error) {
      notify({ tone: "error", title: t("file.copyFailed"), detail: toGitError(error).message });
    }
  };
}

function useExpandShortcut(enabled: boolean, toggle: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.code !== "KeyE") return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, toggle]);
}

function ReviewedToggle({ file, open, onToggleOpen }: Pick<FileActionsProps, "file" | "open" | "onToggleOpen">) {
  const t = useT();
  const pr = useWorkspaceStore((s) => s.pullRequest);
  const key = pr ? reviewKey(pr.number, pr.head, file.path) : "";
  const reviewed = useReviewStore((s) => !!s.reviewed[key]);
  const toggle = useReviewStore((s) => s.toggleReviewed);
  if (!pr) return null;
  return (
    <label className="flex h-6 cursor-default items-center gap-1.5 rounded-md px-1.5 text-[12px] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground">
      <Checkbox
        checked={reviewed}
        onCheckedChange={() => {
          // Like GitHub: marking a file as reviewed folds it out of the way, unmarking unfolds it.
          if (toggle(key) === open) onToggleOpen();
        }}
        className="size-3.5"
      />
      {t("file.reviewed")}
    </label>
  );
}

function Item({
  icon,
  label,
  shortcut,
  onSelect,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuItem className={ITEM} onSelect={onSelect} disabled={disabled}>
      {icon}
      {label}
      {shortcut && <DropdownMenuShortcut className="font-sans text-[12px]">{shortcut}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  );
}

export function FileActions(props: FileActionsProps) {
  const { repoPath, hash, base, file, expanded, onToggleExpanded, selected } = props;
  const t = useT();
  const copy = useCopy();
  const repo = useWorkspaceStore((s) => s.repo);
  const pr = useWorkspaceStore((s) => s.pullRequest);
  const commentOnFile = useUiStore((s) => s.commentOnFile);
  const web = useGithubWebUrl(repoPath).data;
  useExpandShortcut(selected, onToggleExpanded);

  // A deleted file only exists before the change.
  const at = file.status === "deleted" ? base : hash;
  const fileUrl = web && at ? `${web}/blob/${at}/${file.path}` : null;
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <ReviewedToggle {...props} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("file.menu")}
            className="size-6 rounded-full text-muted-foreground data-[state=open]:bg-white/10 data-[state=open]:text-foreground"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="w-56 rounded-xl p-1 shadow-xl">
          {pr && <Item icon={<MessageCircle />} label={t("file.comment")} onSelect={() => commentOnFile(file.path)} />}
          <Item
            icon={<ExternalLink />}
            label={t("file.openGithub")}
            disabled={!fileUrl}
            onSelect={() => fileUrl && void gitBackend.openGithubUrl(fileUrl)}
          />
          <DropdownMenuSeparator />
          <Item
            icon={<Link />}
            label={t("file.copyLink")}
            disabled={!fileUrl}
            onSelect={() => fileUrl && void copy(fileUrl)}
          />
          <Item
            icon={<Copy />}
            label={t("file.copyPath")}
            onSelect={() => void copy(`${repo?.path ?? ""}/${file.path}`)}
          />
          <Item icon={<Copy />} label={t("file.copyName")} onSelect={() => void copy(name)} />
          <Item
            icon={<Copy />}
            label={t("file.copyContents")}
            disabled={!at}
            onSelect={() =>
              at &&
              void copy(
                gitBackend.getFileContents(
                  repoPath,
                  at,
                  file.status === "deleted" && file.previousPath ? file.previousPath : file.path,
                ),
              )
            }
          />
          <DropdownMenuSeparator />
          <Item
            icon={expanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
            label={expanded ? t("file.foldCode") : t("file.expandAll")}
            shortcut="⌥E"
            onSelect={onToggleExpanded}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
