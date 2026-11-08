import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNoticesStore } from "@/stores/notices-store";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

export function Notices() {
  const { notices, dismiss } = useNoticesStore();
  const t = useT();
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 flex-col gap-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg",
            notice.tone === "error" && "border-removed/60",
          )}
        >
          {notice.tone === "error" ? (
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-removed-foreground" />
          ) : (
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-added-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] break-words">{notice.title}</p>
            {notice.detail && (
              <details className="mt-1 text-xs text-muted-foreground">
                <summary className="cursor-default">{t("common.gitOutput")}</summary>
                <pre className="mt-1 max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap select-text">
                  {notice.detail}
                </pre>
              </details>
            )}
          </div>
          <Button variant="ghost" size="icon-xs" aria-label={t("common.dismiss")} onClick={() => dismiss(notice.id)}>
            <X />
          </Button>
        </div>
      ))}
    </div>
  );
}
