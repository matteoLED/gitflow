import { useShallow } from "zustand/react/shallow";
import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ACCENTS, CODE_FONTS, SYNTAX_THEMES, useAppearance, type Accent } from "@/stores/appearance-store";
import { LOCALES, useLocaleStore, useT, type Locale } from "@/i18n";
import { Group, Row, SelectRow } from "./settings-ui";
import { useTokens } from "@/features/diff/DiffCard";
import type { DiffLine } from "@/types/git";
import { themeSwatch, type Contrast, type ThemeChoice, type ThemeId } from "./themes";

const THEME_CHOICES: ThemeChoice[] = ["system", "dark", "midnight", "noir", "light", "pure-light"];
const CONTRASTS: Contrast[] = ["low", "standard", "high", "max"];

/** Linear's "Aa" chip: the theme's own background, sidebar and ink. System shows dark and light halves. */
function ThemeChip({ id }: { id: ThemeChoice }) {
  const halves: ThemeId[] = id === "system" ? ["dark", "light"] : [id];
  return (
    <span aria-hidden className="flex h-12 w-full overflow-hidden rounded-md border border-white/10">
      {halves.map((half) => {
        const swatch = themeSwatch(half);
        return (
          <span key={half} className="flex flex-1" style={{ background: swatch.background }}>
            <span className="w-2.5" style={{ background: swatch.sidebar }} />
            <span className="grid flex-1 place-items-center text-[15px] font-semibold" style={{ color: swatch.text }}>
              Aa
            </span>
          </span>
        );
      })}
    </span>
  );
}

function ThemePicker() {
  const t = useT();
  const { theme, set } = useAppearance(useShallow((s) => ({ theme: s.theme, set: s.set })));
  return (
    <div role="radiogroup" aria-label={t("settings.theme")} className="grid grid-cols-3 gap-2 px-4 py-3 sm:grid-cols-6">
      {THEME_CHOICES.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={theme === id}
          onClick={() => set("theme", id)}
          className={cn(
            "flex flex-col gap-1.5 rounded-lg p-1.5 text-[12px] outline-none hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring",
            theme === id ? "bg-white/[0.06] text-foreground ring-1 ring-primary" : "text-muted-foreground",
          )}
        >
          <ThemeChip id={id} />
          {t(`theme.${id}`)}
        </button>
      ))}
    </div>
  );
}

function ContrastPicker() {
  const t = useT();
  const { contrast, set } = useAppearance(useShallow((s) => ({ contrast: s.contrast, set: s.set })));
  return (
    <Row label={t("settings.contrast")} hint={t("settings.contrastHint")}>
      <div role="radiogroup" aria-label={t("settings.contrast")} className="flex rounded-md bg-white/[0.05] p-0.5">
        {CONTRASTS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={contrast === level}
            onClick={() => set("contrast", level)}
            className={cn(
              "h-6 rounded-[5px] px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
              contrast === level
                ? "bg-white/[0.12] text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`contrast.${level}`)}
          </button>
        ))}
      </div>
    </Row>
  );
}

function AccentPicker() {
  const t = useT();
  const { accent, set } = useAppearance(useShallow((s) => ({ accent: s.accent, set: s.set })));
  return (
    <Row label={t("settings.accent")} hint={t("settings.accentHint")}>
      <div role="radiogroup" aria-label={t("settings.accent")} className="flex gap-2">
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
              accent === key && "ring-2 ring-white/70 ring-offset-2 ring-offset-background",
            )}
          >
            {accent === key && <Check aria-hidden className="size-3.5 text-[#fff]" />}
          </button>
        ))}
      </div>
    </Row>
  );
}

const SCALES = [0.9, 1, 1.1, 1.2].map((value) => ({ value, label: `${Math.round(value * 100)}%` }));
const CODE_SIZES = [10, 11, 12, 13, 14].map((value) => ({ value, label: `${value}px` }));

const SAMPLE: DiffLine[] = [
  { kind: "context", oldLine: 1, newLine: 1, content: "export function greet(name: string): string {" },
  { kind: "removed", oldLine: 2, newLine: null, content: '  return "Hello " + name; // old' },
  { kind: "added", oldLine: null, newLine: 2, content: "  return `Hello, ${name}!`;" },
  { kind: "context", oldLine: 3, newLine: 3, content: "}" },
];
const ROW_TINT = { context: "", removed: "bg-diff-removed", added: "bg-diff-added" } as const;

/** Live sample of the chosen code font, size and syntax theme, tokenized like a real diff. */
function CodePreview() {
  const tokensOf = useTokens("preview.ts", SAMPLE, true);
  return (
    <div className="px-4 py-3">
      <pre
        aria-hidden
        className="overflow-hidden rounded-lg border border-white/8 bg-background py-1.5 font-mono text-(length:--code-size) leading-relaxed"
      >
        {SAMPLE.map((line) => (
          <code key={line.content} className={cn("flex", ROW_TINT[line.kind])}>
            <span className="w-8 shrink-0 pr-3 text-right text-muted-foreground">{line.newLine ?? line.oldLine}</span>
            <span>
              {tokensOf(line)?.map((token, i) => (
                <span key={i} style={{ color: token.color }}>
                  {token.content}
                </span>
              )) ?? line.content}
            </span>
          </code>
        ))}
      </pre>
    </div>
  );
}

export function AppearanceSection() {
  const t = useT();
  const { uiScale, codeFont, codeSize, syntaxTheme, set, reset } = useAppearance(
    useShallow((s) => ({
      uiScale: s.uiScale,
      codeFont: s.codeFont,
      codeSize: s.codeSize,
      syntaxTheme: s.syntaxTheme,
      set: s.set,
      reset: s.reset,
    })),
  );
  const { locale, setLocale } = useLocaleStore(useShallow((s) => ({ locale: s.locale, setLocale: s.setLocale })));
  return (
    <>
      <Group title={t("settings.theme")}>
        <ThemePicker />
        <ContrastPicker />
      </Group>
      <Group title={t("settings.interface")}>
        <SelectRow
          label={t("settings.language")}
          hint={t("settings.languageHint")}
          value={locale}
          onChange={(value: Locale) => setLocale(value)}
          options={(Object.keys(LOCALES) as Locale[]).map((value) => ({ value, label: LOCALES[value] }))}
        />
        <AccentPicker />
        <SelectRow
          label={t("settings.size")}
          hint={t("settings.sizeHint")}
          value={uiScale}
          onChange={(value) => set("uiScale", value)}
          options={SCALES}
        />
      </Group>
      <Group title={t("settings.code")}>
        <CodePreview />
        <SelectRow
          label={t("settings.font")}
          value={codeFont}
          onChange={(value) => set("codeFont", value)}
          options={(Object.keys(CODE_FONTS) as (keyof typeof CODE_FONTS)[]).map((value) => ({
            value,
            label: value === "berkeley" ? t("font.berkeley") : CODE_FONTS[value].label,
          }))}
        />
        <SelectRow
          label={t("settings.fontSize")}
          value={codeSize}
          onChange={(value) => set("codeSize", value)}
          options={CODE_SIZES}
        />
        <SelectRow
          label={t("settings.syntaxTheme")}
          hint={t("settings.syntaxThemeHint")}
          value={syntaxTheme}
          onChange={(value) => set("syntaxTheme", value)}
          options={(Object.keys(SYNTAX_THEMES) as (keyof typeof SYNTAX_THEMES)[]).map((value) => ({
            value,
            label: SYNTAX_THEMES[value],
          }))}
        />
      </Group>
      <div>
        <Button variant="outline" size="sm" onClick={reset} className="h-7 gap-1.5 text-[13px]">
          <RotateCcw aria-hidden className="size-3.5" />
          {t("settings.reset")}
        </Button>
      </div>
    </>
  );
}
