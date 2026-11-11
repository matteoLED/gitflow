import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { PanelToolbar } from "@/components/layout/panel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { gitBackend } from "@/lib/tauri-git";
import { useGitAction } from "@/features/operations/use-git-action";
import type { RefsSnapshot } from "@/types/git";
import { useT } from "@/i18n";

type SyncButtonProps = {
  label: string;
  hint: string;
  icon: ReactNode;
  count?: number;
  pending: boolean;
  onClick: () => void;
};

function SyncButton({ label, hint, icon, count, pending, onClick }: SyncButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={onClick}
          className="h-7 flex-1 gap-1.5 rounded-full border border-white/8 bg-white/[0.05] px-2 text-[11.5px] font-medium hover:bg-white/[0.12] [&_svg]:size-3.5"
        >
          {pending ? <BrailleLoader variant="grid-syncing" /> : icon}
          {label}
          {!!count && <span className="font-normal opacity-60">{count}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

/** Network operations. They use the user's own Git credentials (SSH agent, gh, keychain); nothing is stored here. */
export function SyncBar({ repoPath, refs }: { repoPath: string; refs: RefsSnapshot }) {
  const t = useT();
  const current = refs.branches.find((b) => b.name === refs.head.branch);
  const fetch = useGitAction(repoPath, {
    run: () => gitBackend.fetch(repoPath),
    success: t("sync.fetched"),
    pending: t("sync.fetching"),
    failure: t("sync.fetchFailed"),
  });
  const pull = useGitAction(repoPath, {
    run: () => gitBackend.pull(repoPath),
    success: t("sync.pulled"),
    pending: t("sync.pulling"),
    failure: t("sync.pullFailed"),
  });
  const push = useGitAction(repoPath, {
    run: () => gitBackend.push(repoPath),
    success: t("sync.pushed"),
    pending: t("sync.pushing"),
    failure: t("sync.pushFailed"),
  });
  const pushHint = current?.upstream ? t("sync.pushTo", { upstream: current.upstream }) : t("sync.publish");

  return (
    <PanelToolbar className="h-auto border-t border-white/[0.06] py-2">
      <SyncButton
        label={t("sync.pull")}
        hint={t("sync.pullHint")}
        icon={<ArrowDown aria-hidden />}
        count={current?.behind}
        pending={pull.isPending}
        onClick={() => pull.mutate()}
      />
      <SyncButton
        label={t("sync.push")}
        hint={pushHint}
        icon={<ArrowUp aria-hidden />}
        count={current?.ahead}
        pending={push.isPending}
        onClick={() => push.mutate()}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label={t("sync.fetch")}
            disabled={fetch.isPending}
            onClick={() => fetch.mutate()}
            className="size-7 rounded-full border border-white/8 bg-white/[0.05] hover:bg-white/[0.12] [&_svg]:size-3.5"
          >
            {fetch.isPending ? <BrailleLoader variant="grid-syncing" /> : <RefreshCw aria-hidden />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("sync.fetch")}</TooltipContent>
      </Tooltip>
    </PanelToolbar>
  );
}
