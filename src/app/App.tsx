import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouterProvider } from "@tanstack/react-router";
import { useAppRouter } from "./router";
import { AppErrorBoundary, OfflineBanner } from "@/components/states";
import { Notices } from "@/components/layout/Notices";
import { useApplyAppearance } from "@/features/settings/use-apply-appearance";
import { useAgentEvents } from "@/features/agents/use-agents";

export function createQueryClient() {
  // Git errors are deterministic: retrying a failed `git` call just delays the message.
  // Local data is kept fresh by the repository watcher, so it needn't be refetched on every view switch.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: 30_000, gcTime: 10 * 60_000 } },
  });
}

const queryClient = createQueryClient();

export function App({ client = queryClient }: { client?: QueryClient }) {
  useApplyAppearance();
  useAgentEvents();
  const router = useAppRouter();
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={300}>
        <AppErrorBoundary>
          <RouterProvider router={router} />
        </AppErrorBoundary>
        <OfflineBanner />
        <Notices />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
