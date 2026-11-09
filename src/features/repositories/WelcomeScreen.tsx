import { FolderOpen } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { useOpenRepository } from "./use-open-repository";
import { useT } from "@/i18n";

export function WelcomeScreen() {
  const { pick, error, pending } = useOpenRepository();
  const t = useT();
  return (
    <main
      data-tauri-drag-region
      className="flex h-full flex-col items-center justify-center gap-8 bg-sidebar p-8 text-center"
    >
      <div className="flex flex-col items-center gap-4">
        <BrandMark className="size-14" />
        <h1 className="font-display text-[40px] leading-none">gitflow</h1>
        <p className="max-w-sm text-[14px] text-muted-foreground">{t("welcome.tagline")}</p>
      </div>
      <Button onClick={pick} disabled={pending} className="h-10 gap-2 rounded-full px-5 text-[14px]">
        {pending ? <BrailleLoader /> : <FolderOpen aria-hidden />}
        {t("welcome.open")}
        <kbd aria-hidden className="kbd ml-1 border-white/20 bg-black/15 text-primary-foreground/80">
          ⌘O
        </kbd>
      </Button>
      {error && (
        <p role="alert" className="max-w-md text-sm text-removed-foreground">
          {error.message}
        </p>
      )}
    </main>
  );
}
