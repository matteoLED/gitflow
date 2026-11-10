import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, X } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import type { FileStatus } from "@/types/git";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|ico|bmp)$/i;
export const isImage = (path: string) => IMAGE.test(path);

export type ImageSource = { repoPath: string; hash: string; base: string | null };

const CHECKERBOARD =
  "bg-[conic-gradient(#2a2b30_90deg,#232428_90deg_180deg,#2a2b30_180deg_270deg,#232428_270deg)] bg-[length:16px_16px]";

const ICON_BUTTON =
  "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground";

type Size = { width: number; height: number };

/** Saves one side of the image where the user picks, through the native save dialog. */
function useDownload(path: string, source: ImageSource) {
  const t = useT();
  const notify = useNoticesStore((s) => s.notify);
  return async (oldSide: boolean) => {
    const dest = await save({ defaultPath: path.split("/").pop() });
    if (!dest) return;
    try {
      await gitBackend.saveImage(source.repoPath, source.hash, source.base, path, oldSide, dest);
    } catch (error) {
      notify({ tone: "error", title: t("image.saveFailed"), detail: toGitError(error).message });
    }
  };
}

/** The image as large as the window allows, with its zoom level, like a preview app. */
function Lightbox({
  src,
  name,
  size,
  open,
  onOpenChange,
  onDownload,
}: {
  src: string;
  name: string;
  size: Size;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: () => void;
}) {
  const t = useT();
  const [zoom, setZoom] = useState<number | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex h-[calc(100vh-4rem)] max-w-[calc(100vw-4rem)] flex-col gap-0 overflow-hidden rounded-xl border-white/10 bg-[#1b1b1d] p-0 sm:max-w-[calc(100vw-4rem)]"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 px-3 text-[12.5px]">
          <DialogTitle className="truncate text-[12.5px] font-medium">{name}</DialogTitle>
          {zoom !== null && <span className="text-muted-foreground tabular-nums">{Math.round(zoom * 100)}%</span>}
          <button
            type="button"
            aria-label={t("image.download")}
            onClick={onDownload}
            className={cn(ICON_BUTTON, "ml-auto")}
          >
            <Download className="size-4" />
          </button>
          <DialogClose aria-label={t("image.close")} className={ICON_BUTTON}>
            <X className="size-4" />
          </DialogClose>
        </header>
        {/* ponytail: the fit is measured once when it opens; resizing the window while open doesn't refit. */}
        <div
          ref={(box) => {
            if (!box) return;
            const { width, height } = box.getBoundingClientRect();
            setZoom(Math.min((width - 80) / size.width, (height - 80) / size.height));
          }}
          className="grid min-h-0 flex-1 place-items-center"
        >
          {zoom !== null && (
            <img
              src={src}
              alt={name}
              style={{ width: size.width * zoom, height: size.height * zoom }}
              className={CHECKERBOARD}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Side({
  label,
  name,
  src,
  loading,
  tone,
  onDownload,
}: {
  label: string | null;
  name: string;
  src: string | null | undefined;
  loading: boolean;
  tone: string;
  onDownload: () => void;
}) {
  const t = useT();
  const [size, setSize] = useState<Size | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <figure className="flex min-w-0 flex-1 flex-col items-center gap-2">
      {label && <figcaption className={cn("text-[12px] font-medium", tone)}>{label}</figcaption>}
      {loading ? (
        <BrailleLoader className="my-10 text-primary" label={t("image.loading")} />
      ) : src ? (
        <>
          <button
            type="button"
            aria-label={t("image.open")}
            onClick={() => setOpen(true)}
            className="cursor-zoom-in rounded-[3px] outline outline-1 outline-transparent transition-[outline-color] hover:outline-primary/70 focus-visible:outline-primary"
          >
            <img
              src={src}
              alt={name}
              onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
              className={cn("block max-h-80 max-w-full object-contain", CHECKERBOARD)}
            />
          </button>
          {size && (
            <span className="text-[12px] text-foreground/80 tabular-nums">
              <span className="text-muted-foreground">W</span> {size.width}px ·{" "}
              <span className="text-muted-foreground">H</span> {size.height}px
            </span>
          )}
          {size && (
            <Lightbox src={src} name={name} size={size} open={open} onOpenChange={setOpen} onDownload={onDownload} />
          )}
        </>
      ) : (
        <span className="my-10 rounded bg-black/40 px-2 py-1 text-[12px] text-muted-foreground">{t("image.none")}</span>
      )}
    </figure>
  );
}

/** Binary images shown as pictures: the version before the change next to the one after. */
export function ImageDiff({ path, status, source }: { path: string; status: FileStatus; source: ImageSource }) {
  const t = useT();
  const { repoPath, hash, base } = source;
  const download = useDownload(path, source);
  const load = (oldSide: boolean) => ({
    queryKey: ["image", repoPath, hash, base, path, oldSide],
    queryFn: () => gitBackend.getImage(repoPath, hash, base, path, oldSide),
    staleTime: Infinity,
  });
  const before = useQuery({ ...load(true), enabled: status !== "added" });
  const after = useQuery({ ...load(false), enabled: status !== "deleted" });
  const both = status !== "added" && status !== "deleted";
  const name = path.split("/").pop() ?? path;
  return (
    <div className="relative flex gap-6 px-4 py-6">
      <button
        type="button"
        aria-label={t("image.download")}
        onClick={() => void download(status === "deleted")}
        className={cn(ICON_BUTTON, "absolute top-2 right-2")}
      >
        <Download className="size-4" />
      </button>
      {status !== "added" && (
        <Side
          label={both ? t("image.before") : null}
          name={name}
          src={before.data}
          loading={before.isPending}
          tone="text-removed-foreground"
          onDownload={() => void download(true)}
        />
      )}
      {status !== "deleted" && (
        <Side
          label={both ? t("image.after") : null}
          name={name}
          src={after.data}
          loading={after.isPending}
          tone="text-added-foreground"
          onDownload={() => void download(false)}
        />
      )}
    </div>
  );
}
