import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useLinearStore } from "@/stores/linear-store";

const KEYS_PAGE = "https://linear.app/settings/account/security";

/** Adds a Linear organization with a personal API key; the key goes straight to the Keychain. */
export function ConnectLinear({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const client = useQueryClient();
  const [key, setKey] = useState("");
  const add = useMutation({
    mutationFn: () => gitBackend.linearAddAccount(key),
    onSuccess: (account) => {
      setKey("");
      useLinearStore.getState().setAccount(account.id);
      void client.invalidateQueries({ queryKey: ["linear"] });
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
      className={compact ? "space-y-2" : "mx-auto max-w-sm space-y-3 px-4 py-10 text-center"}
    >
      {!compact && (
        <>
          <KeyRound aria-hidden className="mx-auto size-6 text-primary" />
          <p className="text-[14px] font-medium">{t("linear.connectTitle")}</p>
          <p className="text-[12.5px] text-muted-foreground">{t("linear.connectHint")}</p>
        </>
      )}
      <Input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="lin_api_…"
        aria-label={t("linear.apiKey")}
        autoComplete="off"
        className="h-8 font-mono text-[12.5px] md:text-[12.5px]"
      />
      {add.isError && <p className="text-[12px] text-removed-foreground">{toGitError(add.error).message}</p>}
      <div className={compact ? "flex gap-2" : "flex justify-center gap-2"}>
        <Button type="submit" size="sm" disabled={!key.trim() || add.isPending} className="h-7 gap-1.5 text-[12.5px]">
          {add.isPending && <BrailleLoader />}
          {t("linear.connect")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void gitBackend.openGithubUrl(KEYS_PAGE)}
          className="h-7 gap-1.5 text-[12.5px] text-muted-foreground"
        >
          <ExternalLink aria-hidden className="size-3.5" />
          {t("linear.createKey")}
        </Button>
      </div>
    </form>
  );
}
