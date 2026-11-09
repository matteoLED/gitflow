import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";

/** githubstatus.com's incidents, checked every few minutes; nothing shows while GitHub is fine. */
export function GithubIncident() {
  const t = useT();
  const status = useQuery({
    queryKey: ["github-status"],
    queryFn: gitBackend.githubStatus,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    retry: false,
  }).data;
  if (!status || (status.incidents.length === 0 && status.degraded.length === 0)) return null;
  const incident = status.incidents[0];
  const severe = status.incidents.some((i) => i.impact === "major" || i.impact === "critical");
  const detail = incident?.name ?? t("githubStatus.degraded", { services: status.degraded.join(", ") });
  return (
    <button
      type="button"
      onClick={() => void gitBackend.openGithubUrl(incident?.url ?? "https://www.githubstatus.com/")}
      title={detail}
      className="mx-2 mb-2 flex items-start gap-2.5 rounded-lg border border-white/[0.07] bg-card px-3 py-2.5 text-left outline-none hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CircleAlert
        aria-hidden
        className={cn("mt-px size-4 shrink-0", severe ? "text-removed-foreground" : "text-renamed")}
      />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium">{t("githubStatus.title")}</span>
        <span className="line-clamp-2 text-[11.5px] text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}
