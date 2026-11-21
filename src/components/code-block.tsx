import type { ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";
import { Code } from "lucide-react";
import { useT } from "@/i18n";
import { CopyButton } from "@/components/copy-button";

type Hast = { tagName?: string; value?: string; properties?: { className?: unknown }; children?: Hast[] };
const textOf = (node: Hast): string => node.value ?? (node.children ?? []).map(textOf).join("");

/** Markdown's fenced code: a header with its language and a copy button above the code. */
export function CodeBlock({ node, children, ...rest }: ComponentProps<"pre"> & ExtraProps) {
  const code = (node as Hast | undefined)?.children?.[0];
  const classes = code?.properties?.className;
  const lang = Array.isArray(classes)
    ? String(classes.find((c) => String(c).startsWith("language-")) ?? "").slice("language-".length)
    : "";
  return (
    <div className="code-block not-prose my-2 overflow-hidden rounded-lg border border-white/8 bg-black/25">
      <div className="flex h-7 items-center gap-1.5 border-b border-white/[0.06] pr-1 pl-2.5 text-[11.5px] text-muted-foreground">
        <Code aria-hidden className="size-3.5" />
        <span className="flex-1 truncate font-mono">{lang || "text"}</span>
        <CopyLabel text={code ? textOf(code).replace(/\n$/, "") : ""} />
      </div>
      <pre {...rest}>{children}</pre>
    </div>
  );
}

function CopyLabel({ text }: { text: string }) {
  const t = useT();
  return (
    <CopyButton text={text} label={t("common.copyCode")}>
      {t("common.copy")}
    </CopyButton>
  );
}
