import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useLinearStore } from "@/stores/linear-store";

const KEYS_PAGE = "https://linear.app/settings/account/security";
/** The API key field, focused by the board's "Connect" when no organization is connected yet. */
export const LINEAR_KEY_INPUT = "linear-api-key";

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
  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
      className={compact ? "space-y-2" : "mt-4 w-full max-w-xs space-y-3"}
    >
      <Input
        id={compact ? undefined : LINEAR_KEY_INPUT}
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
  if (compact) return form;
  return (
    <EmptyState
      size="sm"
      className="h-auto"
      icon={<KeyRound />}
      title={t("linear.connectTitle")}
      hint={t("linear.connectHint")}
    >
      {form}
    </EmptyState>
  );
}
