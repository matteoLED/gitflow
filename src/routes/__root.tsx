import { createRootRoute, Navigate, Outlet } from "@tanstack/react-router";
import { SettingsPage } from "@/features/settings/SettingsPage";

export const Route = createRootRoute({
  // Settings sit inside the router: their title bar navigates like the app's.
  component: () => (
    <>
      <Outlet />
      <SettingsPage />
    </>
  ),
  notFoundComponent: () => <Navigate to="/" replace />,
});
