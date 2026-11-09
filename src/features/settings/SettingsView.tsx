import { useState, type ReactNode } from "react";
import {
  ChevronLeft,
  Info,
  Plug,
  Keyboard,
  FolderGit2,
  History,
  Palette,
  SplitSquareHorizontal,
  UserRound,
} from "lucide-react";
import { SidebarBar, TabsBar } from "@/components/layout/TitleBar";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { ProfileSection } from "./ProfileSection";
import { AppearanceSection } from "./AppearanceSection";
import { DiffSection, HistorySection } from "./DiffSection";
import { RepositoriesSection } from "./RepositoriesSection";
import { IntegrationsSection } from "./IntegrationsSection";
import { ShortcutsSection } from "./ShortcutsSection";
import { AboutSection } from "./AboutSection";
import { Kbd } from "./settings-ui";

type Page = { id: string; title: MessageKey; description: MessageKey; Icon: typeof Info; render: () => ReactNode };

const NAV: { title?: MessageKey; pages: Page[] }[] = [
  {
    title: "settings.groupAccount",
    pages: [
      {
        id: "profile",
        title: "settings.profile",
        description: "settings.profileDesc",
        Icon: UserRound,
        render: () => <ProfileSection />,
      },
    ],
  },
  {
    title: "settings.groupApp",
    pages: [
      {
        id: "appearance",
        title: "settings.appearance",
        description: "settings.appearanceDesc",
        Icon: Palette,
        render: () => <AppearanceSection />,
      },
      {
        id: "diff",
        title: "settings.diffPage",
        description: "settings.diffDesc",
        Icon: SplitSquareHorizontal,
        render: () => <DiffSection />,
      },
      {
        id: "history",
        title: "history.section",
        description: "settings.historyDesc",
        Icon: History,
        render: () => <HistorySection />,
      },
      {
        id: "shortcuts",
        title: "settings.shortcuts",
        description: "settings.shortcutsDesc",
        Icon: Keyboard,
        render: () => <ShortcutsSection />,
      },
    ],
  },
  {
    title: "settings.groupWorkspace",
    pages: [
      {
        id: "integrations",
        title: "settings.integrations",
        description: "settings.integrationsDesc",
        Icon: Plug,
        render: () => <IntegrationsSection />,
      },
      {
        id: "repositories",
        title: "repos.title",
        description: "settings.repositoriesDesc",
        Icon: FolderGit2,
        render: () => <RepositoriesSection />,
      },
    ],
  },
  {
    pages: [
      {
        id: "about",
        title: "settings.about",
        description: "settings.aboutDesc",
        Icon: Info,
        render: () => <AboutSection />,
      },
    ],
  },
];
const PAGES = NAV.flatMap((group) => group.pages);

function NavItem({ page, active, onSelect }: { page: Page; active: boolean; onSelect: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "flex h-7 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-sidebar-foreground outline-none hover:bg-white/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-white/10 text-foreground",
      )}
    >
      <page.Icon aria-hidden className={cn("size-3.5", active && "text-primary")} />
      {t(page.title)}
    </button>
  );
}

function SettingsView() {
  const t = useT();
  const close = () => useUiStore.getState().setSettingsOpen(false);
  const [pageId, setPageId] = useState(() => useUiStore.getState().settingsPage ?? PAGES[0].id);
  const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0];
  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="settings-title"
      className="fixed inset-0 z-40 flex animate-in bg-sidebar duration-150 fade-in-0"
    >
      <aside className="flex w-60 shrink-0 flex-col bg-sidebar">
        <SidebarBar />
        <div className="px-2 pt-2 pb-3">
          <button
            type="button"
            onClick={close}
            className="flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-[13px] text-sidebar-foreground outline-none hover:bg-white/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            {t("settings.back")}
          </button>
        </div>
        <nav aria-label={t("settings.sections")} className="flex-1 space-y-4 overflow-y-auto px-2 pt-1 pb-3">
          {NAV.map((group, index) => (
            <div key={group.title ?? index} className="space-y-0.5">
              {group.title && (
                <p className="px-2.5 pb-1 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">
                  {t(group.title)}
                </p>
              )}
              {group.pages.map((p) => (
                <NavItem key={p.id} page={p} active={p.id === page.id} onSelect={() => setPageId(p.id)} />
              ))}
            </div>
          ))}
        </nav>
        <p className="flex items-center gap-1.5 border-t border-white/5 px-4 py-2.5 text-[12px] text-muted-foreground">
          <Kbd>Esc</Kbd> {t("settings.escHint")}
        </p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pr-1.5 pb-1.5">
        {/* Picking a tab leaves settings for that place. */}
        <div onClickCapture={close}>
          <TabsBar controls={false} />
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto rounded-[10px] border border-white/[0.06] bg-background shadow-[0_1px_3px_rgb(0_0_0/0.35)]">
          <div key={page.id} className="mx-auto max-w-[680px] animate-in px-10 pt-12 pb-16 duration-200 fade-in-0">
            <header className="mb-7">
              <h1 id="settings-title" className="text-[22px] font-semibold tracking-tight">
                {t(page.title)}
              </h1>
              <p className="mt-1 text-[13.5px] text-muted-foreground">{t(page.description)}</p>
            </header>
            <div className="space-y-7">{page.render()}</div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default SettingsView;
