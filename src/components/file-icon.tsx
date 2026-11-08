import { getIcon } from "material-file-icons";
import { cn } from "@/lib/utils";

/**
 * Language/file-type logo from the MIT-licensed material-file-icons set.
 * The SVG markup ships inside the package (the file name only selects which one), so injecting it is safe.
 */
export function FileIcon({ path, className }: { path: string; className?: string }) {
  const icon = getIcon(path.slice(path.lastIndexOf("/") + 1));
  return (
    <span
      aria-hidden
      className={cn("inline-block size-4 shrink-0", className)}
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}
