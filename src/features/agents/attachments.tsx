import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { ImageIcon, Paperclip, X } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";

export type Attachment = { path: string; preview: string; name: string };

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const MAX = 8;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Images pasted, dropped or picked for the next message, saved by the app so the agent can open them. */
export function useAttachments() {
  const t = useT();
  const notify = useNoticesStore((s) => s.notify);
  const [items, setItems] = useState<Attachment[]>([]);
  const [saving, setSaving] = useState(0);
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const add = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => EXTENSIONS[f.type]).slice(0, MAX);
      if (images.length === 0) return false;
      setSaving((n) => n + images.length);
      for (const file of images) {
        try {
          const path = await gitBackend.saveAttachment(await readBase64(file), EXTENSIONS[file.type]);
          const preview = URL.createObjectURL(file);
          previews.current.push(preview);
          setItems((prev) => [...prev, { path, preview, name: file.name || "image" }].slice(0, MAX));
        } catch (error) {
          notify({ tone: "error", title: t("attach.failed"), detail: toGitError(error).message });
        } finally {
          setSaving((n) => n - 1);
        }
      }
      return true;
    },
    [notify, t],
  );

  const remove = (path: string) => setItems((prev) => prev.filter((a) => a.path !== path));
  const clear = () => setItems([]);
  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files];
    if (files.some((f) => EXTENSIONS[f.type])) {
      event.preventDefault();
      void add(files);
    }
  };
  const onDrop = (event: DragEvent) => {
    const files = [...event.dataTransfer.files];
    if (files.length) {
      event.preventDefault();
      void add(files);
    }
  };
  return { items, saving: saving > 0, add, remove, clear, onPaste, onDrop };
}

export type Attachments = ReturnType<typeof useAttachments>;

/** Thumbnails above the message, each removable. */
export function AttachmentStrip({ attachments }: { attachments: Attachments }) {
  const t = useT();
  if (attachments.items.length === 0 && !attachments.saving) return null;
  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {attachments.items.map((a) => (
        <div key={a.path} className="group/att relative size-14 overflow-hidden rounded-lg border border-white/10">
          <img src={a.preview} alt={a.name} className="size-full object-cover" />
          <button
            type="button"
            aria-label={t("attach.remove", { name: a.name })}
            onClick={() => attachments.remove(a.path)}
            className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-black/70 text-[#fff] opacity-0 group-hover/att:opacity-100 focus-visible:opacity-100"
          >
            <X aria-hidden className="size-2.5" />
          </button>
        </div>
      ))}
      {attachments.saving && (
        <div className="grid size-14 place-items-center rounded-lg border border-dashed border-white/15">
          <BrailleLoader className="text-primary" />
        </div>
      )}
    </div>
  );
}

/** Paperclip: picks images from disk. */
export function AttachButton({ attachments }: { attachments: Attachments }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label={t("attach.add")}
        title={t("attach.hint")}
        onClick={() => input.current?.click()}
        className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
      >
        <Paperclip aria-hidden className="size-3.5" />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          void attachments.add([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** In a sent message: the images that went with it (their note is hidden from the text). */
export const IMAGES_NOTE = "\n\nImages attached by the user (look at them first):";

export function splitImages(prompt: string): { text: string; images: string[] } {
  const at = prompt.indexOf(IMAGES_NOTE);
  if (at < 0) return { text: prompt, images: [] };
  const images = prompt
    .slice(at + IMAGES_NOTE.length)
    .split("\n")
    .map((l) => l.replace(/^- /, "").trim())
    .filter(Boolean);
  return { text: prompt.slice(0, at), images };
}

export function SentImages({ count }: { count: number }) {
  const t = useT();
  if (!count) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <ImageIcon aria-hidden className="size-3.5" />
      {t.plural("attach.sent", count)}
    </p>
  );
}
