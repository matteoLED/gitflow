import { cn } from "@/lib/utils";

/**
 * "client/src/components…wHeader/components": keeps the end of a path visible, where the useful part is.
 * The browser truncates the head; the tail stays whole.
 */
export function MiddleTruncate({ text, tail = 16, className }: { text: string; tail?: number; className?: string }) {
  if (text.length <= tail + 4) return <span className={cn("truncate", className)}>{text}</span>;
  return (
    <span title={text} className={cn("flex min-w-0", className)}>
      <span className="truncate">{text.slice(0, -tail)}</span>
      <span className="shrink-0 whitespace-pre">{text.slice(-tail)}</span>
    </span>
  );
}
