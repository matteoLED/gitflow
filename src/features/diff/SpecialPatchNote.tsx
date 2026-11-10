import { FolderGit2, HardDrive } from "lucide-react";
import { useT } from "@/i18n";
import { formatSize, type SpecialPatch } from "./special-patch";

/** "Submodule x: abc → def" or "Git LFS object · size", instead of raw pointer/subproject lines. */
export function SpecialPatchNote({ path, special }: { path: string; special: SpecialPatch }) {
  const t = useT();
  const short = (sha: string | null) => sha?.slice(0, 7) ?? "—";
  const size = (bytes: number | null) => (bytes === null ? "—" : formatSize(bytes, t.locale));
  const Icon = special.kind === "submodule" ? FolderGit2 : HardDrive;
  return (
    <p className="flex items-center gap-2 px-4 py-3 text-[12px] text-muted-foreground">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {special.kind === "submodule" ? (
        <span>
          {t("diff.submodule", { path })}{" "}
          <span className="font-mono text-foreground/85">
            {short(special.from)} → {short(special.to)}
          </span>
          {special.dirty && ` · ${t("diff.submoduleDirty")}`}
        </span>
      ) : (
        <span>
          {t("diff.lfs")} ·{" "}
          <span className="font-mono text-foreground/85">
            {special.oldSize !== null && special.newSize !== null
              ? `${size(special.oldSize)} → ${size(special.newSize)}`
              : size(special.newSize ?? special.oldSize)}
          </span>
        </span>
      )}
    </p>
  );
}
