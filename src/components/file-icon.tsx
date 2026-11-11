import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type GetIcon = (name: string) => { svg: string };

/* The icon set weighs ~1.4 MB of SVG: it loads when the first file icon shows, never at startup. */
let getIcon: GetIcon | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  loading ??= import("material-file-icons").then((module) => {
    getIcon = module.getIcon;
    listeners.forEach((listener) => listener());
  });
  return () => listeners.delete(notify);
};
const snapshot = () => getIcon;

/**
 * Language/file-type logo from the MIT-licensed material-file-icons set.
 * The SVG markup ships inside the package (the file name only selects which one), so injecting it is safe.
 */
export function FileIcon({ path, className }: { path: string; className?: string }) {
  const lookup = useSyncExternalStore(subscribe, snapshot);
  const svg = lookup?.(path.slice(path.lastIndexOf("/") + 1)).svg;
  return (
    <span
      aria-hidden
      className={cn("inline-block size-4 shrink-0", className)}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
