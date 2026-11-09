import type { SVGProps } from "react";

/** Claude's spark mark, drawn in currentColor. */
export function ClaudeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 2.5c.4 0 .7.3.8.7l1 5.2 4.5-2.8a.8.8 0 0 1 1.1 1.1l-2.8 4.5 5.2 1a.8.8 0 0 1 0 1.6l-5.2 1 2.8 4.5a.8.8 0 0 1-1.1 1.1l-4.5-2.8-1 5.2a.8.8 0 0 1-1.6 0l-1-5.2-4.5 2.8a.8.8 0 0 1-1.1-1.1l2.8-4.5-5.2-1a.8.8 0 0 1 0-1.6l5.2-1L4.6 6.7a.8.8 0 0 1 1.1-1.1l4.5 2.8 1-5.2c.1-.4.4-.7.8-.7Z" />
    </svg>
  );
}

/** Generic mark for Codex (no brand asset bundled). */
export function CodexIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...props}>
      <path d="m8 9-3 3 3 3M16 9l3 3-3 3M13.5 6l-3 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
