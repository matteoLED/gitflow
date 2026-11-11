import {
  CircleAlert,
  CircleCheck,
  Clock,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  type LucideIcon,
} from "lucide-react";
import type { MessageKey } from "@/i18n";
import type { WorkStatus } from "./work-items";

/** Icon, label and tone of each work status (kept apart from WorkPage so ⌘K doesn't load the page). */
export const STATUS: Record<WorkStatus, { icon: LucideIcon; label: MessageKey; className: string }> = {
  changes: { icon: CircleAlert, label: "work.status.changes", className: "text-removed-foreground" },
  review: { icon: GitPullRequest, label: "work.status.review", className: "text-primary" },
  approved: { icon: CircleCheck, label: "work.status.approved", className: "text-added-foreground" },
  draft: { icon: GitPullRequestDraft, label: "work.status.draft", className: "text-muted-foreground" },
  progress: { icon: GitBranch, label: "work.status.progress", className: "text-renamed" },
  stale: { icon: Clock, label: "work.status.stale", className: "text-muted-foreground" },
  merged: { icon: GitMerge, label: "work.status.merged", className: "text-merged" },
};
