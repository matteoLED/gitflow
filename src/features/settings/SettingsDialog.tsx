import { useEffect, useState, type ReactNode } from "react";
import { Info, Palette, SlidersHorizontal, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { DiffOptionRows, LayoutSwitch, Toggle } from "@/features/diff/ViewOptions";
import { ProfileSection } from "./ProfileSection";
import { AppearanceSection } from "./AppearanceSection";

const SECTIONS: { id: SectionId; label: MessageKey; Icon: typeof Info }[] = [
  { id: "profile", label: "settings.profile", Icon: UserRound },
  { id: "appearance", label: "settings.appearance", Icon: Palette },
  { id: "diff", label: "settings.diff", Icon: SlidersHorizontal },
  { id: "about", label: "settings.about", Icon: Info },
];

type SectionId = "profile" | "appearance" | "diff" | "about";

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-1.5">{children}</div>
    </section>
  );
}

function DiffSection() {
  const t = useT();
  return (
    <>
      <SettingsGroup title={t("options.layout")}>
        <div className="py-1.5">
          <LayoutSwitch />
        </div>
      </SettingsGroup>
      <div className="mb-6 overflow-hidden rounded-lg border border-white/8 bg-white/[0.02] [&>div:first-child]:border-t-0">
        <DiffOptionRows />
      </div>
      <SettingsGroup title={t("history.section")}>
        <Toggle setting="firstParentOnly" label={t("history.firstParent")} hint={t("history.firstParentHint")} />
        <Toggle setting="hideMerges" label={t("history.hideMerges")} hint={t("history.hideMergesHint")} />
      </SettingsGroup>
    </>
  );
}

function AboutSection() {
  const t = useT();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);
  return (
    <SettingsGroup title="gitflow">
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 py-1.5 text-[11.5px]">
        <dt className="text-muted-foreground">{t("settings.version")}</dt>
        <dd>{version ?? t("settings.devBuild")}</dd>
        <dt className="text-muted-foreground">Git</dt>
        <dd>{t("settings.aboutGit")}</dd>
        <dt className="text-muted-foreground">GitHub</dt>
        <dd>{t("settings.aboutGithub")}</dd>
      </dl>
    </SettingsGroup>
  );
}

const CONTENT: Record<SectionId, () => ReactNode> = {
  profile: () => <ProfileSection />,
  appearance: () => <AppearanceSection />,
  diff: () => <DiffSection />,
  about: () => <AboutSection />,
};

/** ⌘, opens settings, as in every macOS app. */
function useSettingsShortcut() {
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.key !== ",") return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);
}

export function SettingsDialog() {
  useSettingsShortcut();
  const t = useT();
  const { settingsOpen, setSettingsOpen } = useUiStore();
  const [section, setSection] = useState<SectionId>("profile");
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="flex h-[min(600px,85vh)] max-w-[760px] gap-0 overflow-hidden p-0 sm:max-w-[760px]">
        <nav
          aria-label={t("settings.sections")}
          className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-white/8 bg-sidebar p-2 pt-4"
        >
          <DialogTitle className="px-2.5 pb-3 text-[13px]">{t("settings.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("settings.description")}</DialogDescription>
          {SECTIONS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
              className={cn(
                "flex h-7 items-center gap-2 rounded-md px-2.5 text-left text-[11.5px] text-sidebar-foreground outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring",
                section === id && "bg-white/8 text-foreground",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          <h2 className="mb-5 text-[15px] font-semibold">{t(current.label)}</h2>
          {CONTENT[section]()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
