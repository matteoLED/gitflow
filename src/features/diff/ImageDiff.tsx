import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrailleLoader } from "@/components/braille-loader";
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import type { FileStatus } from "@/types/git";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|ico|bmp)$/i;
export const isImage = (path: string) => IMAGE.test(path);

export type ImageSource = { repoPath: string; hash: string; base: string | null };

const CHECKERBOARD =
  "bg-[conic-gradient(#2a2b30_90deg,#232428_90deg_180deg,#2a2b30_180deg_270deg,#232428_270deg)] bg-[length:16px_16px]";

function Side({
  label,
  src,
  loading,
  tone,
}: {
  label: string;
  src: string | null | undefined;
  loading: boolean;
  tone: string;
}) {
  const t = useT();
  const [size, setSize] = useState<string | null>(null);
  return (
    <figure className="min-w-0 flex-1">
      <figcaption className="mb-1.5 flex items-center gap-2 text-[12px]">
        <span className={cn("font-medium", tone)}>{label}</span>
        {size && <span className="text-muted-foreground tabular-nums">{size}</span>}
      </figcaption>
      <div
        className={cn(
          "grid min-h-32 place-items-center overflow-hidden rounded-lg border border-white/8 p-2",
          CHECKERBOARD,
        )}
      >
        {loading ? (
          <BrailleLoader className="text-primary" label={t("image.loading")} />
        ) : src ? (
          <img
            src={src}
            alt={label}
            onLoad={(e) => setSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
            className="max-h-80 max-w-full object-contain"
          />
        ) : (
          <span className="rounded bg-black/40 px-2 py-1 text-[12px] text-muted-foreground">{t("image.none")}</span>
        )}
      </div>
    </figure>
  );
}

/** Binary images shown as pictures: the version before the change next to the one after. */
export function ImageDiff({ path, status, source }: { path: string; status: FileStatus; source: ImageSource }) {
  const t = useT();
  const { repoPath, hash, base } = source;
  const load = (oldSide: boolean) => ({
    queryKey: ["image", repoPath, hash, base, path, oldSide],
    queryFn: () => gitBackend.getImage(repoPath, hash, base, path, oldSide),
    staleTime: Infinity,
  });
  const before = useQuery({ ...load(true), enabled: status !== "added" });
  const after = useQuery({ ...load(false), enabled: status !== "deleted" });
  return (
    <div className="flex gap-3 p-3">
      {status !== "added" && (
        <Side label={t("image.before")} src={before.data} loading={before.isPending} tone="text-removed-foreground" />
      )}
      {status !== "deleted" && (
        <Side label={t("image.after")} src={after.data} loading={after.isPending} tone="text-added-foreground" />
      )}
    </div>
  );
}
