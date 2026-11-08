import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ACCENTS,
  CODE_FONTS,
  SYNTAX_THEMES,
  useAppearance,
  type Accent,
  type Appearance,
} from "@/stores/appearance-store";
import { SettingsGroup } from "./SettingsDialog";
import { LOCALES, useLocaleStore, useT, type Locale } from "@/i18n";

function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <label htmlFor={htmlFor} className="text-[11.5px] text-foreground/85">
        {label}
        {hint && <span className="block text-[10px] text-muted-foreground">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

type SelectRowProps<K extends keyof Appearance> = {
  setting: K;
  label: string;
  hint?: string;
  options: { value: Appearance[K]; label: string }[];
};

function SelectRow<K extends keyof Appearance>({ setting, label, hint, options }: SelectRowProps<K>) {
  const id = useId();
  const { [setting]: value, set } = useAppearance();
  const toValue = (raw: string) => options.find((o) => String(o.value) === raw)?.value ?? value;
  return (
    <Row label={label} hint={hint} htmlFor={id}>
      <Select value={String(value)} onValueChange={(raw) => set(setting, toValue(raw))}>
        <SelectTrigger id={id} size="sm" className="h-7 w-52 text-[11.5px] data-[size=sm]:h-7">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={String(option.value)} value={String(option.value)} className="text-[11.5px]">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

function LanguagePicker() {
  const t = useT();
  const id = useId();
  const { locale, setLocale } = useLocaleStore();
  return (
    <Row label={t("settings.language")} hint={t("settings.languageHint")} htmlFor={id}>
      <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
        <SelectTrigger id={id} size="sm" className="h-7 w-52 text-[11.5px] data-[size=sm]:h-7">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(LOCALES) as Locale[]).map((code) => (
            <SelectItem key={code} value={code} className="text-[11.5px]">
              {LOCALES[code]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

function AccentPicker() {
  const t = useT();
  const { accent, set } = useAppearance();
  return (
    <Row label={t("settings.accent")}>
      <div role="radiogroup" aria-label={t("settings.accent")} className="flex gap-1.5">
        {(Object.keys(ACCENTS) as Accent[]).map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={accent === key}
            aria-label={t(ACCENTS[key].label)}
            title={t(ACCENTS[key].label)}
            onClick={() => set("accent", key)}
            style={{ backgroundColor: ACCENTS[key].color }}
            className={cn(
              "grid size-6 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              accent === key && "ring-2 ring-white/70",
            )}
          >
            {accent === key && <Check aria-hidden className="size-3.5 text-white" />}
          </button>
        ))}
      </div>
    </Row>
  );
}

const SCALES = [0.9, 1, 1.1, 1.2].map((value) => ({ value, label: `${Math.round(value * 100)}%` }));
const CODE_SIZES = [10, 11, 12, 13, 14].map((value) => ({ value, label: `${value}px` }));

export function AppearanceSection() {
  const t = useT();
  const reset = useAppearance((s) => s.reset);
  return (
    <>
      <SettingsGroup title={t("settings.interface")}>
        <LanguagePicker />
        <AccentPicker />
        <SelectRow setting="uiScale" label={t("settings.size")} hint={t("settings.sizeHint")} options={SCALES} />
      </SettingsGroup>
      <SettingsGroup title={t("settings.code")}>
        <SelectRow
          setting="codeFont"
          label={t("settings.font")}
          options={(Object.keys(CODE_FONTS) as (keyof typeof CODE_FONTS)[]).map((value) => ({
            value,
            label: value === "berkeley" ? t("font.berkeley") : CODE_FONTS[value].label,
          }))}
        />
        <SelectRow setting="codeSize" label={t("settings.fontSize")} options={CODE_SIZES} />
        <SelectRow
          setting="syntaxTheme"
          label={t("settings.syntaxTheme")}
          options={(Object.keys(SYNTAX_THEMES) as (keyof typeof SYNTAX_THEMES)[]).map((value) => ({
            value,
            label: SYNTAX_THEMES[value],
          }))}
        />
      </SettingsGroup>
      <Button variant="ghost" size="sm" onClick={reset} className="h-7 text-[11.5px] text-muted-foreground">
        {t("settings.reset")}
      </Button>
    </>
  );
}
