import { useId, useState, type ComponentProps, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BrailleLoader } from "@/components/braille-loader";
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
import { Group, Row } from "./settings-ui";
import { useT } from "@/i18n";

function GithubAccount({ repoPath }: { repoPath: string }) {
  const t = useT();
  const user = useGithubUser(repoPath);
  if (user.isError) {
    return (
      <Row
        label={t("settings.notConnectedTitle")}
        hint={t("settings.notConnected", { message: toGitError(user.error).message })}
      />
    );
  }
  if (!user.data) return <Row label={<BrailleLoader variant="grid-orbit" label={t("common.loading")} />} />;
  const name = user.data.name ?? user.data.login;
  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <AuthorAvatar name={name} src={user.data.avatarUrl} className="size-12" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">{name}</p>
        <p className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
          <GithubIcon className="size-3" />@{user.data.login}
        </p>
      </div>
      <span className="flex items-center gap-1.5 rounded-full border border-added/30 bg-added/10 px-2.5 py-1 text-[12px] text-added-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-added-foreground" />
        {t("settings.connected")}
      </span>
    </div>
  );
}

function FieldRow({ label, ...props }: { label: string } & ComponentProps<typeof Input>) {
  const id = useId();
  return (
    <Row label={label} htmlFor={id}>
      <Input id={id} className="h-7 w-64 text-[13px] md:text-[13px]" {...props} />
    </Row>
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
    <form onSubmit={submit} className="divide-y divide-white/[0.06]">
      <FieldRow label={t("settings.name")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      <FieldRow label={t("settings.email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <div className="flex justify-end px-4 py-2.5">
        <Button type="submit" size="sm" disabled={!dirty || save.isPending} className="h-7 text-[13px]">
          {save.isPending && <BrailleLoader />}
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
      <Group title={t("settings.githubAccount")} description={t("settings.githubHint")}>
        {repo ? <GithubAccount repoPath={repo.path} /> : <Row label={t("settings.openRepoFirst")} />}
      </Group>
      <Group title={t("settings.gitIdentity")} description={t("settings.identityHint")}>
        {identity.isError ? (
          <Row label={toGitError(identity.error).message} />
        ) : identity.data ? (
          <IdentityForm key={`${identity.data.name}|${identity.data.email}`} initial={identity.data} />
        ) : (
          <Row label={<BrailleLoader variant="grid-orbit" label={t("common.loading")} />} />
        )}
      </Group>
    </>
  );
}
