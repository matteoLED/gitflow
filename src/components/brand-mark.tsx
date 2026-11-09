import { cn } from "@/lib/utils";

/** gitflow's mark: two branches flowing into one, in the accent color. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={cn("size-6 text-primary", className)}>
      <rect width="32" height="32" rx="9" fill="currentColor" opacity="0.14" />
      <path
        d="M10 7v6.5c0 3.6 2.4 5.2 6 6.2s6 2.6 6 6.3V25M22 7v4.5c0 2.6-1.4 4.3-3.6 5.3"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="7" r="2.6" fill="currentColor" />
      <circle cx="22" cy="7" r="2.6" fill="currentColor" />
      <circle cx="22" cy="25.5" r="2.6" fill="currentColor" />
    </svg>
  );
}
