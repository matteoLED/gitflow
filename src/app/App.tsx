import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";
import { Notices } from "@/components/layout/Notices";
import { useApplyAppearance } from "@/features/settings/use-apply-appearance";
import { SettingsDialog } from "@/features/settings/SettingsDialog";

export function createQueryClient() {
  // Git errors are deterministic: retrying a failed `git` call just delays the message.
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } } });
}

const queryClient = createQueryClient();

export function App({ client = queryClient }: { client?: QueryClient }) {
  useApplyAppearance();
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={300}>
        <AppShell />
        <Notices />
        <SettingsDialog />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
