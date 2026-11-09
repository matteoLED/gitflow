import { useEffect, useState } from "react";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { VIEW_PATHS, VIEWS, viewAt } from "./routes";

function createAppRouter() {
  // Settings sit inside the router: their title bar navigates like the app's.
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <SettingsPage />
      </>
    ),
    notFoundComponent: () => <Navigate to="/" replace />,
  });
  const pages = VIEWS.map((view) =>
    createRoute({ getParentRoute: () => root, path: VIEW_PATHS[view], component: () => <AppShell view={view} /> }),
  );
  // Hash-based: the Tauri webview serves files, not a history-API server.
  return createRouter({ routeTree: root.addChildren(pages), history: createHashHistory() });
}

type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}

/**
 * The URL decides the page. Store actions that move to another page (open a pull request, show a branch's
 * history, switch repository) still set `view`; this keeps both in step, so back/forward work too.
 */
function bindViewToUrl(router: AppRouter) {
  const store = useWorkspaceStore;
  const go = (path: string, replace = false) => void router.navigate({ to: path, replace });
  // On start the store wins: it holds the active repository's restored page.
  if (viewAt(router.state.location.pathname) !== store.getState().view) go(VIEW_PATHS[store.getState().view], true);
  const offRouter = router.subscribe("onResolved", ({ toLocation }) => {
    const view = viewAt(toLocation.pathname);
    if (view && view !== store.getState().view) store.setState({ view });
  });
  const offStore = store.subscribe((state, previous) => {
    if (state.view !== previous.view && viewAt(router.state.location.pathname) !== state.view)
      go(VIEW_PATHS[state.view]);
  });
  return () => {
    offRouter();
    offStore();
  };
}

export function useAppRouter() {
  const [router] = useState(createAppRouter);
  useEffect(() => bindViewToUrl(router), [router]);
  return router;
}
