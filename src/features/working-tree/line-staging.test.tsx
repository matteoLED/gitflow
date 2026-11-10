import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLineStaging } from "./line-staging";

vi.mock("@/lib/tauri-git", () => ({ gitBackend: { applyHunks: vi.fn() } }));

const header = "diff --git a/f b/f\n--- a/f\n+++ b/f\n";
const FIRST = `${header}@@ -1,2 +1,2 @@\n-a\n+A\n b\n`;
const REFRESHED = `${header}@@ -1,3 +1,3 @@\n-a\n+A\n b\n c\n`;
const CHANGE = { path: "f", previousPath: null, side: "unstaged" } as const;

function Harness({ patch }: { patch: string }) {
  const { staging, toolbar } = useLineStaging("/repo", CHANGE, patch);
  return (
    <>
      <button onClick={() => staging?.onPick(0, "only")}>pick</button>
      {toolbar}
    </>
  );
}

const client = new QueryClient();
const withClient = (patch: string) => (
  <QueryClientProvider client={client}>
    <Harness patch={patch} />
  </QueryClientProvider>
);

describe("useLineStaging", () => {
  it("doesn't reopen a discard confirmation asked on a diff that has since refreshed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(withClient(FIRST));
    await user.click(screen.getByText("pick"));
    await user.click(screen.getByText("Discard lines…"));
    rerender(withClient(REFRESHED));
    await user.click(screen.getByText("pick"));
    expect(screen.queryByText("Discard selected lines?")).toBeNull();
  });
});
