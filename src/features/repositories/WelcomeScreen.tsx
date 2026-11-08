import { FolderGit2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOpenRepository } from "./use-open-repository";
import { useT } from "@/i18n";

export function WelcomeScreen() {
  const { pick, error, pending } = useOpenRepository();
  const t = useT();
  return (
    <main data-tauri-drag-region className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <FolderGit2 aria-hidden className="size-10 text-primary" />
        <h1 className="text-xl font-semibold">gitflow</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("welcome.tagline")}</p>
      </div>
      <Button onClick={pick} disabled={pending}>
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : <FolderGit2 aria-hidden />}
        {t("welcome.open")}
      </Button>
      {error && (
        <p role="alert" className="max-w-md text-sm text-removed-foreground">
          {error.message}
        </p>
      )}
    </main>
  );
}
