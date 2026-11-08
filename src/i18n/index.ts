import { create } from "zustand";
import { persist } from "zustand/middleware";
import { en, type MessageKey } from "./en";
import { fr } from "./fr";

export type Locale = "en" | "fr";
export type { MessageKey };

export const LOCALES: Record<Locale, string> = { en: "English", fr: "Français" };

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, fr };

type Params = Record<string, string | number>;

/** Base keys that have `_one` / `_other` plural forms. */
type PluralKey = MessageKey extends infer K ? (K extends `${infer Base}_other` ? Base : never) : never;

function detectLocale(): Locale {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

type LocaleState = { locale: Locale; setLocale: (locale: Locale) => void };

/** Defaults to the system language, then remembers the user's choice. */
export const useLocaleStore = create<LocaleState>()(
  persist((set) => ({ locale: detectLocale(), setLocale: (locale) => set({ locale }) }), { name: "gitflow.locale" }),
);

export function translate(locale: Locale, key: MessageKey, params: Params = {}): string {
  const template = DICTIONARIES[locale][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** Plural-aware: French uses the singular for 0 and 1, English only for 1 — Intl knows both. */
export function translatePlural(locale: Locale, key: PluralKey, count: number, params: Params = {}): string {
  const form = new Intl.PluralRules(locale).select(count) === "one" ? "one" : "other";
  return translate(locale, `${key}_${form}` as MessageKey, { count, ...params });
}

export type Translator = {
  (key: MessageKey, params?: Params): string;
  plural: (key: PluralKey, count: number, params?: Params) => string;
  locale: Locale;
};

function makeTranslator(locale: Locale): Translator {
  const t = ((key: MessageKey, params?: Params) => translate(locale, key, params)) as Translator;
  t.plural = (key, count, params) => translatePlural(locale, key, count, params);
  t.locale = locale;
  return t;
}

const TRANSLATORS: Record<Locale, Translator> = { en: makeTranslator("en"), fr: makeTranslator("fr") };

/** `const t = useT(); t("sync.pull"); t.plural("files.count", 3)`. Re-renders when the language changes. */
export function useT(): Translator {
  return TRANSLATORS[useLocaleStore((s) => s.locale)];
}

/** For code outside React components (stores, helpers). */
export function getT(): Translator {
  return TRANSLATORS[useLocaleStore.getState().locale];
}
