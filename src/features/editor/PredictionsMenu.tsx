import type { RefObject, SVGProps } from "react";
import type { EditorView } from "@codemirror/view";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Sparkles, SparklesIcon } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ClaudeIcon, CodexIcon } from "@/features/agents/agent-icons";
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useCompletionStore, type CompletionProvider, type DisplayMode } from "@/stores/completion-store";
import { useUiStore } from "@/stores/ui-store";
import { copilotSignOut } from "./copilot";
import { predictNow } from "./inline-completion";

/** Copilot's goggles mark, drawn in currentColor (simplified). */
function CopilotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 4C7.6 4 4 6.4 4 10v5.5C4 18 7.6 20 12 20s8-2 8-4.5V10c0-3.6-3.6-6-8-6Zm-3.5 4h2c1.1 0 2 .9 2 2v1.5c0 1.1-.9 2-2 2h-2c-1.1 0-2-.9-2-2V10c0-1.1.9-2 2-2Zm5 0h2c1.1 0 2 .9 2 2v1.5c0 1.1-.9 2-2 2h-2c-1.1 0-2-.9-2-2V10c0-1.1.9-2 2-2ZM9 15.5h1.5V18H9v-2.5Zm4.5 0H15V18h-1.5v-2.5Z" />
    </svg>
  );
}

const PROVIDERS = {
  off: { label: "", Icon: SparklesIcon, docs: null },
  copilot: { label: "GitHub Copilot", Icon: CopilotIcon, docs: "https://docs.github.com/en/copilot" },
  claude: { label: "Claude", Icon: ClaudeIcon, docs: "https://docs.claude.com/en/api/overview" },
  openai: { label: "OpenAI", Icon: CodexIcon, docs: "https://platform.openai.com/docs" },
} as const;

const ITEM = "h-7 gap-2 px-2 text-[13px]";
const CHECK_ITEM = "h-7 pr-2 text-[13px]";
const LABEL = "px-2 pt-1.5 pb-1 text-[11.5px] font-medium text-muted-foreground";

/** `languageName` is the key the setting stores; `languageLabel` what the menu shows. */
type Props = { uri: string; languageName: string; languageLabel: string; view: RefObject<EditorView | null> };

/** The status bar's edit predictions control, as in Zed: where predictions show, how, and from whom. */
export function PredictionsMenu({ uri, languageName, languageLabel, view }: Props) {
  const t = useT();
  const provider = useCompletionStore((s) => s.provider);
  const busy = useCompletionStore((s) => s.busy);
  const enabled = useCompletionStore((s) => s.enabled);
  const fileOn = useCompletionStore((s) => !s.disabledFiles.includes(uri));
  const languageOn = useCompletionStore((s) => !s.disabledLanguages.includes(languageName));
  const displayMode = useCompletionStore((s) => s.displayMode);
  const store = useCompletionStore.getState();
  const signOut = useMutation({ mutationFn: copilotSignOut });
  const { label, Icon, docs } = PROVIDERS[provider];
  const name = provider === "off" ? t("predictions.off") : label;
  const active = provider !== "off" && enabled && fileOn && languageOn;
  const openSettings = () => useUiStore.getState().setSettingsOpen(true, "completion");
  // Toggles keep the menu open, as in Zed.
  const stay = (e: Event) => e.preventDefault();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("predictions.title", { provider: name })}
              className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-white/[0.06] hover:text-foreground"
            >
              {busy ? <BrailleLoader /> : <Icon className={cn("size-3.5", !active && "opacity-40")} />}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-2">
          {t("predictions.title", { provider: name })}
          <kbd className="font-sans opacity-60">⌃⌘I</kbd>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="end" sideOffset={6} className="w-64 rounded-xl p-1 shadow-xl">
        <DropdownMenuLabel className={LABEL}>{t("predictions.showFor")}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          className={CHECK_ITEM}
          checked={fileOn}
          onSelect={stay}
          onCheckedChange={() => store.toggleFile(uri)}
        >
          {t("predictions.thisFile")}
          <DropdownMenuShortcut>⌃⌘E</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          className={CHECK_ITEM}
          checked={languageOn}
          onSelect={stay}
          onCheckedChange={() => store.toggleLanguage(languageName)}
        >
          {languageLabel}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          className={CHECK_ITEM}
          checked={enabled}
          onSelect={stay}
          onCheckedChange={store.toggleEnabled}
        >
          {t("predictions.allFiles")}
          <DropdownMenuShortcut>⌃⌘I</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className={LABEL}>{t("predictions.displayMode")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={displayMode} onValueChange={(v) => store.setDisplayMode(v as DisplayMode)}>
          <DropdownMenuRadioItem className={CHECK_ITEM} value="eager" onSelect={stay}>
            {t("predictions.eager")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem className={CHECK_ITEM} value="subtle" onSelect={stay}>
            {t("predictions.subtle")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className={LABEL}>{t("predictions.privacy")}</DropdownMenuLabel>
        <DropdownMenuItem className={ITEM} onSelect={openSettings}>
          {t("predictions.excluded")}
        </DropdownMenuItem>
        {docs && (
          <DropdownMenuItem className={ITEM} onSelect={() => void gitBackend.openGithubUrl(docs)}>
            {t("predictions.docs")}
            <ExternalLink aria-hidden className="ml-auto size-3.5 text-muted-foreground" />
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className={LABEL}>{t("predictions.actions")}</DropdownMenuLabel>
        <DropdownMenuItem
          className={ITEM}
          disabled={!active}
          onSelect={() => {
            const editor = view.current;
            if (!editor) return;
            editor.focus();
            predictNow(editor);
          }}
        >
          {t("predictions.predictNow")}
          <DropdownMenuShortcut>⌥⇥</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className={LABEL}>{t("predictions.providers")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={provider} onValueChange={(v) => store.setProvider(v as CompletionProvider)}>
          {(Object.keys(PROVIDERS) as CompletionProvider[]).map((id) => (
            <DropdownMenuRadioItem key={id} className={CHECK_ITEM} value={id}>
              {id === "off" ? t("predictions.off") : PROVIDERS[id].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuItem className={ITEM} onSelect={openSettings}>
          <Sparkles aria-hidden className="size-3.5 text-muted-foreground" />
          {t("predictions.configure")}
        </DropdownMenuItem>
        {provider === "copilot" && (
          <>
            <DropdownMenuItem
              className={ITEM}
              onSelect={() => void gitBackend.openGithubUrl("https://github.com/settings/copilot")}
            >
              {t("predictions.copilotSettings")}
              <ExternalLink aria-hidden className="ml-auto size-3.5 text-muted-foreground" />
            </DropdownMenuItem>
            <DropdownMenuItem className={ITEM} onSelect={() => signOut.mutate()}>
              {t("completion.signOut")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
