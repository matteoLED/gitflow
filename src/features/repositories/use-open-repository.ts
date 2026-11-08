import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { gitBackend } from "@/lib/tauri-git";
import { toGitError } from "@/lib/errors";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useNoticesStore } from "@/stores/notices-store";
import type { GitErrorPayload } from "@/types/git";
import { getT } from "@/i18n";

/** Native folder picker → validation by the Rust side → workspace switch. */
export function useOpenRepository() {
  const openRepo = useWorkspaceStore((s) => s.openRepo);
  const [error, setError] = useState<GitErrorPayload | null>(null);
  const [pending, setPending] = useState(false);

  const pick = async () => {
    setError(null);
    const folder = await open({ directory: true, multiple: false, title: getT()("repo.dialogTitle") }).catch(
      toGitError,
    );
    if (typeof folder !== "string") {
      if (folder) setError(folder);
      return;
    }
    setPending(true);
    try {
      openRepo(await gitBackend.openRepository(folder));
    } catch (err) {
      setError(toGitError(err));
    } finally {
      setPending(false);
    }
  };

  /** Reopens a path from the history; a moved or deleted folder is dropped from it with an explanation. */
  const reopen = async (path: string) => {
    try {
      openRepo(await gitBackend.openRepository(path));
    } catch (err) {
      const failure = toGitError(err);
      useWorkspaceStore.getState().forgetRecent(path);
      useNoticesStore.getState().notify({ tone: "error", title: failure.message, detail: failure.detail });
    }
  };

  return { pick, reopen, error, pending };
}
