import { Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";

/**
 * Between two columns: a hairline that's easy to grab (a 9px invisible hit area around it), lit while
 * hovered and drawn in the accent while dragging.
 */
export function ResizeHandle({ className }: { className?: string }) {
  return (
    <Separator
      className={cn(
        "group/resize relative w-px bg-white/[0.06] outline-none",
        "after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:z-10 after:content-['']",
        "before:absolute before:inset-y-0 before:left-1/2 before:z-10 before:w-0.5 before:-translate-x-1/2 before:bg-transparent before:transition-colors before:delay-75 before:content-['']",
        "data-[separator=hover]:before:bg-white/20 data-[separator=active]:before:bg-primary",
        className,
      )}
    />
  );
}

/** In the gutter between the sidebar and the inset page: invisible until hovered. */
export function GutterHandle() {
  return <ResizeHandle className="w-1.5 bg-transparent" />;
}
