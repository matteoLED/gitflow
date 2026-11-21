import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

type IconProps = SVGProps<SVGSVGElement>;

/** Linear's pull request glyphs: a branch on the left, a hook into the target on the right. */
function Glyph({ className, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4 shrink-0", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

const HOOK = "M7.5 3.5H9.5A2.5 2.5 0 0 1 12 6";

export function PrOpenIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="4" cy="3.5" r="1.75" />
      <path d="M4 5.25V14" />
      <path d={`${HOOK}V10.25`} />
      <circle cx="12" cy="12" r="1.75" />
    </Glyph>
  );
}

/** A draft: the hook ends in code brackets, nothing to merge yet. */
export function PrDraftIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="4" cy="3.5" r="1.75" />
      <path d="M4 5.25V14" />
      <path d={`${HOOK}V7.5`} />
      <path d="M10.6 10.25 9.25 11.75 10.6 13.25M13.4 10.25l1.35 1.5-1.35 1.5" />
    </Glyph>
  );
}

/** Closed: the branch's head crossed out. */
export function PrClosedIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m2.5 2 3 3m0-3-3 3" />
      <path d="M4 7.5V14" />
      <path d={`${HOOK}V10.25`} />
      <circle cx="12" cy="12" r="1.75" />
    </Glyph>
  );
}
