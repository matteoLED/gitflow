import type { ReactNode } from "react";
import { Brain, ChevronDown, Cpu, Lock, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useAgentsStore } from "@/stores/agents-store";
import type { AgentKind, AgentMode } from "@/types/git";

const MODES: { mode: AgentMode; label: MessageKey; hint: MessageKey; Icon: typeof Lock; tone: string }[] = [
  { mode: "plan", label: "run.plan", hint: "run.planHint", Icon: Lock, tone: "text-muted-foreground" },
  { mode: "auto", label: "run.auto", hint: "run.autoHint", Icon: Sparkles, tone: "text-primary" },
  {
    mode: "accept-edits",
    label: "run.acceptEdits",
    hint: "run.acceptEditsHint",
    Icon: ShieldCheck,
    tone: "text-added-foreground",
  },
  { mode: "bypass", label: "run.bypass", hint: "run.bypassHint", Icon: ShieldAlert, tone: "text-removed-foreground" },
];

const MODELS: Record<AgentKind, { value: string | null; label: string }[]> = {
  claude: [
    { value: null, label: "Default (recommended)" },
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku" },
  ],
  codex: [
    { value: null, label: "Default (recommended)" },
    { value: "gpt-5-codex", label: "GPT-5 Codex" },
    { value: "gpt-5", label: "GPT-5" },
  ],
};

const EFFORTS = [null, "low", "medium", "high", "xhigh", "max"] as const;

function Menu({ trigger, title, children }: { trigger: ReactNode; title: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground outline-none hover:bg-white/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/10">
        {trigger}
        <ChevronDown aria-hidden className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-52 rounded-xl p-1">
        <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase">
          {title}
        </DropdownMenuLabel>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mode, model and effort for the next message, like Claude Code's own picker. */
export function RunSettingsBar({ agent }: { agent: AgentKind }) {
  const t = useT();
  const { runSettings, setRunSettings } = useAgentsStore(
    useShallow((s) => ({ runSettings: s.runSettings, setRunSettings: s.setRunSettings })),
  );
  const mode = MODES.find((m) => m.mode === runSettings.mode) ?? MODES[0];
  const model = MODELS[agent].find((m) => m.value === runSettings.model) ?? MODELS[agent][0];
  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
      <Menu
        title={t("run.modeTitle")}
        trigger={
          <span className={cn("flex items-center gap-1", mode.tone)}>
            <mode.Icon aria-hidden className="size-3.5" />
            {t(mode.label)}
          </span>
        }
      >
        {MODES.map((m) => (
          <DropdownMenuItem
            key={m.mode}
            onSelect={() => setRunSettings({ mode: m.mode })}
            className="items-start gap-2 px-2 py-1.5"
          >
            <m.Icon aria-hidden className={cn("mt-0.5 size-3.5", m.tone)} />
            <span>
              <span className="block text-[12.5px]">{t(m.label)}</span>
              <span className="block text-[11px] text-muted-foreground">{t(m.hint)}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </Menu>
      <Menu
        title={t("run.modelTitle")}
        trigger={
          <span className="flex items-center gap-1">
            <Cpu aria-hidden className="size-3.5" />
            {model.value ? model.label : t("run.default")}
          </span>
        }
      >
        {MODELS[agent].map((m) => (
          <DropdownMenuItem
            key={m.label}
            onSelect={() => setRunSettings({ model: m.value })}
            className="px-2 py-1.5 text-[12.5px]"
          >
            {m.label}
          </DropdownMenuItem>
        ))}
      </Menu>
      <Menu
        title={t("run.effortTitle")}
        trigger={
          <span className="flex items-center gap-1">
            <Brain aria-hidden className="size-3.5" />
            {runSettings.effort}
          </span>
        }
      >
        {EFFORTS.map((e) => (
          <DropdownMenuItem
            key={e ?? "default"}
            onSelect={() => setRunSettings({ effort: e })}
            className="px-2 py-1.5 text-[12.5px]"
          >
            {e ?? t("run.default")}
          </DropdownMenuItem>
        ))}
      </Menu>
    </div>
  );
}
