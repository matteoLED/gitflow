import { useEffect } from "react";
import { Check, Ellipsis, FolderGit2, FolderOpen, Languages, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MiddleTruncate } from "@/components/middle-truncate";
import { LOCALES, useLocaleStore, useT, type Locale } from "@/i18n";
import { useUiStore } from "@/stores/ui-store";
import { useOpenRepository } from "@/features/repositories/use-open-repository";
import type { RepositoryInfo } from "@/types/git";

const ITEM = "h-7 gap-2 px-2 text-[12px] [&_svg]:size-3.5 [&_svg]:text-muted-foreground";

/** ⌘O opens the folder picker from anywhere in the app. */
function useOpenShortcut(pick: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.key.toLowerCase() !== "o") return;
      event.preventDefault();
      pick();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pick]);
}

function LanguageMenu() {
  const t = useT();
  const { locale, setLocale } = useLocaleStore();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={ITEM}>
        <Languages aria-hidden />
        {t("menu.language")}
        <span className="ml-auto pr-1 text-[11px] text-muted-foreground">{LOCALES[locale]}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-36">
        {(Object.keys(LOCALES) as Locale[]).map((code) => (
          <DropdownMenuItem key={code} className={ITEM} onSelect={() => setLocale(code)}>
            <Check aria-hidden className={locale === code ? "" : "invisible"} />
            {LOCALES[code]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function AppMenu({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const { pick } = useOpenRepository();
  const openSettings = useUiStore((s) => s.setSettingsOpen);
  useOpenShortcut(() => void pick());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("menu.label")}
          className="ml-auto size-6 text-muted-foreground data-[state=open]:bg-white/10 data-[state=open]:text-foreground"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-64 rounded-xl p-1 shadow-xl">
        <div className="flex items-center gap-2.5 px-2 pt-1.5 pb-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/20 text-primary">
            <FolderGit2 aria-hidden className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold">{repo.name}</p>
            <MiddleTruncate text={repo.path} tail={22} className="text-[10.5px] text-muted-foreground" />
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={ITEM} onSelect={() => void pick()}>
          <FolderOpen aria-hidden />
          {t("menu.open")}
          <DropdownMenuShortcut className="text-[11px]">⌘O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <LanguageMenu />
        <DropdownMenuItem className={ITEM} onSelect={() => openSettings(true)}>
          <Settings aria-hidden />
          {t("menu.settings")}
          <DropdownMenuShortcut className="text-[11px]">⌘,</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
