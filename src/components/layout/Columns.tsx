import type { ReactNode } from "react";
import { Group, useDefaultLayout } from "react-resizable-panels";

/** Resizable columns whose sizes persist under `id`. */
export function Columns({ id, children }: { id: string; children: ReactNode }) {
  const layout = useDefaultLayout({ id, storage: localStorage });
  return (
    <Group
      orientation="horizontal"
      className="h-full"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      {children}
    </Group>
  );
}
