import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { useRefs } from "@/lib/git-queries";
import { useStashStore } from "./stash-store";

/** Opens the stash dialog; shows how many stashes there are. */
export function StashButton({ repoPath }: { repoPath: string }) {
  const t = useT();
  const count = useRefs(repoPath).data?.stashes.length ?? 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label={t("stash.open")}
          onClick={() => useStashStore.getState().show()}
          className="ml-auto text-muted-foreground"
        >
          <Archive />
          {count > 0 && <span className="tabular-nums">{count}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("stash.open")}</TooltipContent>
    </Tooltip>
  );
}
