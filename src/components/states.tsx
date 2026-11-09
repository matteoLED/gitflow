import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { RotateCw, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getT, useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/* Error and empty states, after the Mntal design system: calm, centred, one clear next step. */

type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZES = {
  sm: { box: "py-8", icon: "[&_svg]:size-6", title: "text-[13px]", text: "text-[12px]" },
  md: { box: "py-12", icon: "[&_svg]:size-8", title: "text-[15px]", text: "text-[13px]" },
  lg: { box: "py-16", icon: "[&_svg]:size-10", title: "text-[18px]", text: "text-[14px]" },
};

export function EmptyState({ title, description, icon, action, size = "md", className }: EmptyStateProps) {
  const s = SIZES[size];
  return (
    <div className={cn("flex h-full flex-col items-center justify-center px-6 text-center", s.box, className)}>
      {icon && <div className={cn("mb-4 text-muted-foreground", s.icon)}>{icon}</div>}
      <p className={cn("font-medium text-foreground", s.title)}>{title}</p>
      {description && <div className={cn("mt-1 max-w-sm text-muted-foreground", s.text)}>{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A panel whose data couldn't load: what failed, why, a retry, and Git's own output on demand. */
export function DataUnavailable({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  const t = useT();
  const { message, detail } = toGitError(error);
  return (
    <EmptyState
      size="sm"
      icon={<TriangleAlert className="text-removed-foreground" />}
      title={title}
      description={
        <>
          <p>{message}</p>
          {detail && (
            <details className="mt-2 text-left">
              <summary className="cursor-default text-center text-[12px] hover:text-foreground">
                {t("problem.details")}
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-white/8 bg-black/25 p-2 font-mono text-[11px] whitespace-pre-wrap select-text">
                {detail}
              </pre>
            </details>
          )}
        </>
      }
      action={
        onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="h-7 gap-1.5 text-[12.5px]">
            <RotateCw aria-hidden className="size-3.5" />
            {t("problem.retry")}
          </Button>
        )
      }
    />
  );
}

type ProblemAction = { label: string; onClick: () => void };

type ProblemScreenProps = {
  eyebrow: string;
  title: string;
  description: ReactNode;
  primary?: ProblemAction;
  secondary?: ProblemAction;
  children?: ReactNode;
};

/** Full-window problem page: eyebrow, big title, one sentence, actions. */
export function ProblemScreen({ eyebrow, title, description, primary, secondary, children }: ProblemScreenProps) {
  return (
    <main
      data-tauri-drag-region
      className="flex h-full flex-col items-center justify-center bg-background px-6 py-16 text-center"
    >
      <p className="mb-4 text-[12px] font-bold tracking-wide text-primary uppercase italic">{eyebrow}</p>
      <h1 className="mb-4 text-[34px] font-medium tracking-tight">{title}</h1>
      <div className="max-w-lg text-[15px] leading-relaxed text-muted-foreground">{description}</div>
      <div className="mt-10 flex items-center gap-3">
        {primary && <Button onClick={primary.onClick}>{primary.label}</Button>}
        {secondary && (
          <Button variant="outline" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        )}
      </div>
      {children}
    </main>
  );
}

type BoundaryState = { error: Error | null };

/** Last line of defence: a render crash shows a calm page instead of a blank window. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("gitflow crashed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const t = getT();
    return (
      <ProblemScreen
        eyebrow={t("problem.crashEyebrow")}
        title={t("problem.crashTitle")}
        description={t("problem.crashDescription")}
        primary={{ label: t("problem.retry"), onClick: () => this.setState({ error: null }) }}
        secondary={{ label: t("problem.reload"), onClick: () => window.location.reload() }}
      >
        <details className="mt-10 w-full max-w-lg text-left text-[12px] text-muted-foreground">
          <summary className="cursor-default text-center hover:text-foreground">{t("problem.details")}</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-white/8 bg-black/25 p-3 font-mono text-[11px] whitespace-pre-wrap select-text">
            {error.stack ?? error.message}
          </pre>
        </details>
      </ProblemScreen>
    );
  }
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Shown only while offline: network actions and GitHub won't work, local Git still does. */
export function OfflineBanner() {
  const t = useT();
  if (useOnline()) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center"
    >
      <div className="flex items-center gap-3 rounded-full border border-white/10 bg-popover px-4 py-1.5 text-[12.5px] shadow-xl">
        <span className="flex items-center gap-1.5 rounded-full bg-amber-400/20 px-2 py-0.5 text-amber-200">
          <WifiOff aria-hidden className="size-3.5" />
          {t("problem.offline")}
        </span>
        <span className="text-muted-foreground">{t("problem.offlineHint")}</span>
      </div>
    </div>
  );
}
