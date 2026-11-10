/** Patches that read badly as text: a submodule's commit change, or a Git LFS pointer file. */
export type SpecialPatch =
  | { kind: "submodule"; from: string | null; to: string | null; dirty: boolean }
  | { kind: "lfs"; oldSize: number | null; newSize: number | null };

const SUBPROJECT = /^([-+])Subproject commit ([0-9a-f]+)(-dirty)?$/;
const LFS_VERSION = "version https://git-lfs.github.com/spec/v1";

/** Old (`-`/context) and new (`+`/context) sides of a patch's hunk lines. */
function sides(patch: string): { old: string[]; next: string[] } {
  const body = patch.split("\n").filter((l) => !l.startsWith("---") && !l.startsWith("+++") && !l.startsWith("@@"));
  return {
    old: body.filter((l) => l[0] === "-" || l[0] === " ").map((l) => l.slice(1)),
    next: body.filter((l) => l[0] === "+" || l[0] === " ").map((l) => l.slice(1)),
  };
}

function lfsSize(lines: string[]): number | null {
  if (!lines.includes(LFS_VERSION)) return null;
  const size = lines.find((l) => l.startsWith("size "));
  return size ? Number(size.slice(5)) : null;
}

export function specialPatch(patch: string): SpecialPatch | null {
  if (patch.includes("Subproject commit ")) {
    const result: SpecialPatch = { kind: "submodule", from: null, to: null, dirty: false };
    for (const line of patch.split("\n")) {
      const match = SUBPROJECT.exec(line);
      if (!match) continue;
      if (match[1] === "-") {
        result.from = match[2];
      } else {
        result.to = match[2];
        result.dirty = !!match[3];
      }
    }
    if (result.from || result.to) return result;
  }
  if (!patch.includes(LFS_VERSION)) return null;
  const { old, next } = sides(patch);
  const oldSize = lfsSize(old);
  const newSize = lfsSize(next);
  return oldSize === null && newSize === null ? null : { kind: "lfs", oldSize, newSize };
}

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

export function formatSize(bytes: number, locale: string): string {
  const exp = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exp;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: UNITS[exp],
    unitDisplay: "short",
    maximumFractionDigits: exp === 0 ? 0 : 1,
  }).format(value);
}
