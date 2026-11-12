import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_EXCLUDED } from "@/features/editor/inline-completion-logic";

export type CompletionProvider = "off" | "copilot" | "claude" | "openai";
export type DisplayMode = "eager" | "subtle";
export const CLAUDE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"] as const;
export const OPENAI_MODELS = ["gpt-4.1-mini", "gpt-4.1-nano"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
export type OpenAiModel = (typeof OPENAI_MODELS)[number];

type CompletionState = {
  provider: CompletionProvider;
  claudeModel: ClaudeModel;
  openaiModel: OpenAiModel;
  /** "All files" (^⌘I): predictions on or off everywhere, the provider kept. */
  enabled: boolean;
  /** File URIs and language names where predictions are off. */
  disabledFiles: string[];
  disabledLanguages: string[];
  displayMode: DisplayMode;
  /** Globs of files never sent to a provider. */
  excluded: string[];
  /** A request is in flight (not persisted): the editor's status bar shows a spinner. */
  busy: boolean;
  setProvider: (provider: CompletionProvider) => void;
  setClaudeModel: (model: ClaudeModel) => void;
  setOpenAiModel: (model: OpenAiModel) => void;
  toggleEnabled: () => void;
  toggleFile: (uri: string) => void;
  toggleLanguage: (language: string) => void;
  setDisplayMode: (mode: DisplayMode) => void;
  setExcluded: (globs: string[]) => void;
  setBusy: (busy: boolean) => void;
};

const toggled = (list: string[], item: string) =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

/** Inline AI completion settings (no secrets: API keys live in the Keychain). Off by default. */
export const useCompletionStore = create<CompletionState>()(
  persist(
    (set) => ({
      provider: "off",
      claudeModel: "claude-haiku-5-5",
      openaiModel: "gpt-4.1-mini",
      enabled: true,
      disabledFiles: [],
      disabledLanguages: [],
      displayMode: "eager",
      excluded: DEFAULT_EXCLUDED,
      busy: false,
      setProvider: (provider) => set({ provider }),
      setClaudeModel: (claudeModel) => set({ claudeModel }),
      setOpenAiModel: (openaiModel) => set({ openaiModel }),
      toggleEnabled: () => set((s) => ({ enabled: !s.enabled })),
      toggleFile: (uri) => set((s) => ({ disabledFiles: toggled(s.disabledFiles, uri) })),
      toggleLanguage: (language) => set((s) => ({ disabledLanguages: toggled(s.disabledLanguages, language) })),
      setDisplayMode: (displayMode) => set({ displayMode }),
      setExcluded: (excluded) => set({ excluded }),
      setBusy: (busy) => set({ busy }),
    }),
    {
      name: "gitflow.completion",
      partialize: (s) => ({
        provider: s.provider,
        claudeModel: s.claudeModel,
        openaiModel: s.openaiModel,
        enabled: s.enabled,
        disabledFiles: s.disabledFiles,
        disabledLanguages: s.disabledLanguages,
        displayMode: s.displayMode,
        excluded: s.excluded,
      }),
    },
  ),
);
