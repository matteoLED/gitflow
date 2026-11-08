import { useState, type ComponentProps, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthorAvatar } from "@/components/author-avatar";
import { GithubIcon } from "@/components/github-icon";
import { useGitIdentity, useGithubUser } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { toGitError } from "@/lib/errors";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { GitIdentity } from "@/types/git";
import { SettingsGroup } from "./SettingsDialog";
import { useT } from "@/i18n";

function GithubAccount({ repoPath }: { repoPath: string }) {
  const t = useT();
  const user = useGithubUser(repoPath);
  if (user.isError) {
    return (
      <p className="py-2 text-[11.5px] text-muted-foreground">
        {t("settings.notConnected", { message: toGitError(user.error).message })}
      </p>
    );
  }
  if (!user.data) return <p className="py-2 text-[11.5px] text-muted-foreground">{t("common.loading")}</p>;
  return (
    <div className="flex items-center gap-3 py-2">
      <AuthorAvatar name={user.data.name ?? user.data.login} src={user.data.avatarUrl} className="size-10" />
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold">{user.data.name ?? user.data.login}</p>
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <GithubIcon className="size-3" />@{user.data.login}
        </p>
      </div>
    </div>
  );
}

function Field({ id, label, ...props }: { id: string; label: string } & ComponentProps<typeof Input>) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-3 py-1.5">
      <label htmlFor={id} className="text-[11.5px] text-foreground/85">
        {label}
      </label>
      <Input id={id} className="h-7 text-[12px] md:text-[12px]" {...props} />
    </div>
  );
}

function IdentityForm({ initial }: { initial: GitIdentity }) {
  const t = useT();
  const queryClient = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const [name, setName] = useState(initial.name ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const save = useMutation({
    mutationFn: () => gitBackend.setGitIdentity(name, email),
    onSuccess: (identity) => {
      queryClient.setQueryData(["git-identity"], identity);
      notify({ tone: "success", title: t("settings.identitySaved") });
    },
    onError: (error) => {
      const { message, detail } = toGitError(error);
      notify({ tone: "error", title: t("settings.identityFailed", { message }), detail });
    },
  });
  const dirty = name !== (initial.name ?? "") || email !== (initial.email ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit}>
      <Field
        id="git-name"
        label={t("settings.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
      />
      <Field
        id="git-email"
        label={t("settings.email")}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <div className="flex items-center justify-between gap-3 py-2">
        <p className="text-[10.5px] text-muted-foreground">{t("settings.identityHint")}</p>
        <Button type="submit" size="sm" disabled={!dirty || save.isPending} className="h-7 text-[11.5px]">
          {save.isPending && <Loader2 aria-hidden className="animate-spin" />}
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

export function ProfileSection() {
  const t = useT();
  const repo = useWorkspaceStore((s) => s.repo);
  const identity = useGitIdentity();
  return (
    <>
      <SettingsGroup title={t("settings.githubAccount")}>
        {repo ? (
          <GithubAccount repoPath={repo.path} />
        ) : (
          <p className="py-2 text-[11.5px] text-muted-foreground">{t("settings.openRepoFirst")}</p>
        )}
      </SettingsGroup>
      <SettingsGroup title={t("settings.gitIdentity")}>
        {identity.isError ? (
          <p className="py-2 text-[11.5px] text-removed-foreground">{toGitError(identity.error).message}</p>
        ) : identity.data ? (
          <IdentityForm key={`${identity.data.name}|${identity.data.email}`} initial={identity.data} />
        ) : (
          <p className="py-2 text-[11.5px] text-muted-foreground">{t("common.loading")}</p>
        )}
      </SettingsGroup>
    </>
  );
}
