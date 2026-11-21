import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/** Copies `text`, then shows a check for a moment. `children` adds a label next to the icon. */
export function CopyButton({
  text,
  label,
  className,
  children,
}: {
  text: string;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? t("status.copied") : label}
      title={label}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded px-1 text-[11.5px] text-muted-foreground outline-none hover:bg-white/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {copied ? <Check aria-hidden className="size-3 text-check-passed" /> : <Copy aria-hidden className="size-3" />}
      {children && <span>{copied ? t("status.copied") : children}</span>}
    </button>
  );
}
