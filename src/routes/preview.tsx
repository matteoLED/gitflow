import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";

export const Route = createFileRoute("/preview")({
  component: () => <AppShell view="preview" />,
});
