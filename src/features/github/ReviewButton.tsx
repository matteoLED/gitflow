import { useShallow } from "zustand/react/shallow";
import { useState, type KeyboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, MessageSquare, MessageSquareDiff } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useT, type MessageKey } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { repoKey } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import { useUiStore } from "@/stores/ui-store";
import type { ActivePullRequest } from "@/stores/workspace-store";
import type { ReviewEvent } from "@/types/git";

const EVENTS: { event: ReviewEvent; label: MessageKey; hint: MessageKey; Icon: typeof MessageSquare; tone: string }[] =
  [
    {
      event: "comment",
      label: "review.comment",
      hint: "review.commentHint",
      Icon: MessageSquare,
      tone: "text-foreground",
    },
    {
      event: "approve",
      label: "review.approve",
      hint: "review.approveHint",
      Icon: CircleCheck,
      tone: "text-added-foreground",
    },
    {
      event: "request-changes",
      label: "review.requestChanges",
      hint: "review.requestChangesHint",
      Icon: CircleX,
      tone: "text-removed-foreground",
    },
  ];

function EventPicker({ value, onChange }: { value: ReviewEvent; onChange: (event: ReviewEvent) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t("review.title")} className="space-y-0.5 px-1.5">
      {EVENTS.map(({ event, label, hint, Icon, tone }) => (
        <button
          key={event}
          type="button"
          role="radio"
          aria-checked={value === event}
          onClick={() => onChange(event)}
          className={cn(
            "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring",
            value === event && "bg-white/10",
          )}
        >
          <Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", tone)} />
          <span>
            <span className="block text-[13px] font-medium">{t(label)}</span>
            <span className="block text-[12px] text-muted-foreground">{t(hint)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ReviewForm({ repoPath, pr, onDone }: { repoPath: string; pr: ActivePullRequest; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const [event, setEvent] = useState<ReviewEvent>("comment");
  const { reviewDraft: body, setReviewDraft: setBody } = useUiStore(
    useShallow((s) => ({ reviewDraft: s.reviewDraft, setReviewDraft: s.setReviewDraft })),
  );
  const submit = useMutation({
    mutationFn: () => gitBackend.submitReview(repoPath, pr.number, event, body),
    onSuccess: () => {
      notify({ tone: "success", title: t("review.sent", { number: pr.number }) });
      void queryClient.invalidateQueries({ queryKey: [...repoKey(repoPath), "pull-requests"] });
      setBody("");
      onDone();
    },
    onError: (error) => {
      const { message, detail } = toGitError(error);
      notify({ tone: "error", title: t("review.failed"), detail: detail ?? message });
    },
  });
  const missingBody = event !== "approve" && body.trim() === "";
  const send = () => !missingBody && !submit.isPending && submit.mutate();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      <div className="px-3 pt-3 pb-2">
        <p className="mb-2 truncate text-[13px] font-semibold">
          {t("review.title")} · #{pr.number}
        </p>
        <Textarea
          autoFocus
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t("review.title")}
          placeholder={t("review.placeholder")}
          className="min-h-24 resize-none text-[13px] md:text-[13px]"
        />
      </div>
      <EventPicker value={event} onChange={setEvent} />
      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-white/[0.07] px-3 py-2">
        <span className="text-[12px] text-muted-foreground">{missingBody && t("review.needsBody")}</span>
        <Button size="sm" disabled={missingBody || submit.isPending} onClick={send} className="h-7 text-[13px]">
          {submit.isPending && <BrailleLoader />}
          {t("review.submit")}
        </Button>
      </div>
    </>
  );
}

/** Submits a GitHub review (comment, approve, request changes) for the pull request being read. */
export function ReviewButton({ repoPath, pr }: { repoPath: string; pr: ActivePullRequest }) {
  const t = useT();
  const { reviewOpen: open, setReviewOpen: setOpen } = useUiStore(
    useShallow((s) => ({ reviewOpen: s.reviewOpen, setReviewOpen: s.setReviewOpen })),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="mr-auto h-6 gap-1.5 rounded-full px-2.5 text-[12.5px] [&_svg]:size-3.5">
          <MessageSquareDiff aria-hidden />
          {t("review.button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[340px] overflow-hidden rounded-xl p-0 shadow-xl">
        <ReviewForm repoPath={repoPath} pr={pr} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
