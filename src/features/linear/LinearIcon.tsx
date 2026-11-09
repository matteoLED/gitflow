import type { SVGProps } from "react";

/** Linear's mark, simplified, in currentColor. */
export function LinearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M2.4 13.6 10.4 21.6A10 10 0 0 1 2.4 13.6Zm-.4-3 12 12a9.9 9.9 0 0 0 2.4-.9L2.9 8.2a9.9 9.9 0 0 0-.9 2.4Zm1.9-4.2 13.7 13.7a10 10 0 0 0 1.6-1.4L5.3 4.8A10 10 0 0 0 3.9 6.4ZM6.9 3.6 20.4 17.1A10 10 0 0 0 6.9 3.6Z" />
    </svg>
  );
}
