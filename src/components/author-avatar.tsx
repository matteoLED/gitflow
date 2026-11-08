import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const HUES = [262, 200, 160, 30, 340, 120, 290, 15];

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** GitHub picture when available; initials on a hue derived from the name otherwise (and while loading). */
export function AuthorAvatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  const hue = HUES[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % HUES.length];
  return (
    <Avatar className={cn("size-7 shrink-0", className)} title={name}>
      {src && <AvatarImage src={src} alt={name} />}
      <AvatarFallback
        style={{ backgroundColor: `hsl(${hue} 35% 30%)`, color: `hsl(${hue} 60% 85%)` }}
        className="text-[10px] font-semibold"
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
