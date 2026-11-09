import { useShallow } from "zustand/react/shallow";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MiddleTruncate } from "@/components/middle-truncate";
import { useT } from "@/i18n";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useUiStore } from "@/stores/ui-store";
import { RepoTile } from "@/features/repositories/RepoSwitcher";
import { useOpenRepository } from "@/features/repositories/use-open-repository";
import type { RepositoryInfo } from "@/types/git";
import { Group, Row } from "./settings-ui";

function RepoLabel({ repo }: { repo: RepositoryInfo }) {
  return (
    <span className="flex items-center gap-2.5">
      <RepoTile name={repo.name} className="size-7 text-[13px]" />
      <span className="min-w-0">
        <span className="block truncate">{repo.name}</span>
        <MiddleTruncate text={repo.path} tail={28} className="text-[12px] font-normal text-muted-foreground" />
      </span>
    </span>
  );
}

const ACTION = "h-7 text-[13px]";

export function RepositoriesSection() {
  const t = useT();
  const {
    repo: active,
    repos,
    recentRepos,
    switchRepo,
    closeRepo,
    forgetRecent,
  } = useWorkspaceStore(
    useShallow((s) => ({
      repo: s.repo,
      repos: s.repos,
      recentRepos: s.recentRepos,
      switchRepo: s.switchRepo,
      closeRepo: s.closeRepo,
      forgetRecent: s.forgetRecent,
    })),
  );
  const closeSettings = () => useUiStore.getState().setSettingsOpen(false);
  const { pick, reopen } = useOpenRepository();
  const openPaths = new Set(repos.map((r) => r.path));
  const recent = recentRepos.filter((r) => !openPaths.has(r.path));
  return (
    <>
      <Group title={t("repos.open")} description={t("settings.openReposHint")}>
        {repos.length === 0 && <Row label={t("settings.noRepos")} />}
        {repos.map((repo, index) => (
          <Row key={repo.path} label={<RepoLabel repo={repo} />}>
            {index < 9 && <span className="text-[12px] text-muted-foreground">⌘{index + 1}</span>}
            {repo.path === active?.path ? (
              <span className="px-2 text-[12.5px] text-primary">{t("settings.active")}</span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className={ACTION}
                onClick={() => {
                  switchRepo(repo.path);
                  closeSettings();
                }}
              >
                {t("settings.show")}
              </Button>
            )}
            <Button variant="outline" size="sm" className={ACTION} onClick={() => closeRepo(repo.path)}>
              {t("settings.close")}
            </Button>
          </Row>
        ))}
      </Group>
      {recent.length > 0 && (
        <Group title={t("repos.recent")} description={t("settings.recentHint")}>
          {recent.map((repo) => (
            <Row key={repo.path} label={<RepoLabel repo={repo} />}>
              <Button
                variant="ghost"
                size="sm"
                className={ACTION}
                onClick={() => {
                  void reopen(repo.path);
                  closeSettings();
                }}
              >
                {t("settings.reopen")}
              </Button>
              <Button variant="outline" size="sm" className={ACTION} onClick={() => forgetRecent(repo.path)}>
                {t("settings.forget")}
              </Button>
            </Row>
          ))}
        </Group>
      )}
      <div>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[13px]" onClick={() => void pick()}>
          <FolderOpen aria-hidden className="size-3.5" />
          {t("menu.open")}
        </Button>
      </div>
    </>
  );
}
