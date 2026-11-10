import { useState } from "react";
import type { EditorView } from "@codemirror/view";
import { Sparkles } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { startAgentWithNotice } from "@/features/agents/use-agents";
import { useT } from "@/i18n";

/** What the agent is asked about: a file, a line range, and the code itself. */
export type Selection = { path: string; from: number; to: number; code: string };

/** The selection, or the line under the cursor when nothing is selected. */
export function selectionOf(view: EditorView, path: string): Selection {
  const { state } = view;
  const range = state.selection.main;
  const from = state.doc.lineAt(range.from);
  const to = state.doc.lineAt(range.to);
  const code = range.empty ? from.text : state.sliceDoc(range.from, range.to);
  return { path, from: from.number, to: to.number, code };
}

const where = (s: Selection) => `${s.path}:${s.from}${s.to > s.from ? `-${s.to}` : ""}`;

/** ⌘L: a short request about the selected code, sent to an agent working on the repository. */
export function AskAgent({
  repoPath,
  selection,
  onClose,
}: {
  repoPath: string;
  selection: Selection | null;
  onClose: () => void;
}) {
  const t = useT();
  const [request, setRequest] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!selection || !request.trim()) return;
    setSending(true);
    const prompt = [`In ${where(selection)}:`, "```\n" + selection.code + "\n```", request.trim()].join("\n\n");
    const started = await startAgentWithNotice(
      repoPath,
      prompt,
      `${where(selection)} · ${request.trim().slice(0, 40)}`,
    );
    setSending(false);
    if (started) {
      setRequest("");
      onClose();
    }
  };
  return (
    <Dialog open={!!selection} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden rounded-xl border-white/10 p-0 shadow-2xl sm:max-w-[620px]"
      >
        <DialogTitle className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-2.5 text-[12.5px] font-normal text-muted-foreground">
          <Sparkles aria-hidden className="size-3.5 text-primary" />
          {t("editor.askAbout")}
          <span className="truncate font-mono text-foreground">{selection && where(selection)}</span>
        </DialogTitle>
        {selection && (
          <pre className="max-h-40 overflow-auto border-b border-white/[0.07] bg-black/20 px-4 py-2.5 font-mono text-[12px] text-foreground/80">
            {selection.code}
          </pre>
        )}
        <textarea
          autoFocus
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          placeholder={t("editor.askPlaceholder")}
          className="block w-full resize-none bg-transparent px-4 py-3 text-[13.5px] outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-end gap-2 px-3 pb-3 text-[12px] text-muted-foreground">
          {sending && <BrailleLoader className="text-primary" />}
          {t("editor.askHint")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
