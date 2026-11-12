import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActionMenu } from "./code-actions";

/** Zed's code actions list at the cursor line: ↑↓ to move, Enter to apply, Esc to close (back to the code). */
export function CodeActionMenu({ menu, onClose }: { menu: ActionMenu; onClose: (applied: boolean) => void }) {
  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => !open && onClose(false)}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: menu.x, top: menu.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={0}
        className="max-h-72 max-w-[28rem] min-w-56 rounded-lg p-1 shadow-xl"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {menu.actions.map((action, i) => (
          <DropdownMenuItem
            key={`${i}:${action.title}`}
            // The first row starts selected, as in Zed (after Radix has focused the menu itself).
            ref={i === 0 ? (el) => void (el && requestAnimationFrame(() => el.focus())) : undefined}
            className="h-6 px-2 font-mono text-[12.5px] focus:bg-primary/25"
            onSelect={() => {
              onClose(true);
              menu.run(action);
            }}
          >
            <span className="truncate">{action.title}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
