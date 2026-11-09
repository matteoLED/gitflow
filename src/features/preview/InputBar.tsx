import { useState } from "react";
import { CornerDownLeft } from "lucide-react";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { usePreviewStore } from "@/stores/preview-store";

/** Answers a running script's prompts (menus, yes/no): the line goes to its standard input. */
export function InputBar({ targetId }: { targetId: string }) {
  const t = useT();
  const [text, setText] = useState("");
  const send = async () => {
    const line = text;
    setText("");
    // Echo what was sent, like a terminal would, so the log reads naturally.
    usePreviewStore.getState().apply({ type: "log", targetId, task: null, line: `› ${line}` });
    try {
      await gitBackend.sendPreviewInput(targetId, line);
    } catch (error) {
      usePreviewStore.getState().apply({ type: "log", targetId, task: null, line: `✕ ${toGitError(error).message}` });
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] bg-black/25 px-4 py-1.5"
    >
      <span aria-hidden className="font-mono text-[12px] text-primary">
        ›
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={t("preview.input")}
        placeholder={t("preview.inputPlaceholder")}
        className="h-7 min-w-0 flex-1 bg-transparent font-mono text-[12px] outline-none placeholder:text-muted-foreground"
      />
      <CornerDownLeft aria-hidden className="size-3.5 text-muted-foreground" />
    </form>
  );
}
