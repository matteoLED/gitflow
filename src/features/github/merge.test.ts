import { describe, expect, it, vi } from "vitest";
import { gitBackend } from "@/lib/tauri-git";
import type { PullRequestDetails } from "@/types/git";
import { mergeConfirmed } from "./merge";

vi.mock("@/lib/tauri-git", () => ({ gitBackend: { mergePullRequest: vi.fn(), getPullRequestDetails: vi.fn() } }));

describe("mergeConfirmed", () => {
  it("counts a merge GitHub reported as failed but did", async () => {
    vi.mocked(gitBackend.mergePullRequest).mockRejectedValue(new Error("502 Bad Gateway"));
    vi.mocked(gitBackend.getPullRequestDetails).mockResolvedValue({ state: "MERGED" } as PullRequestDetails);
    await expect(mergeConfirmed("/r", 1, "squash", 0)).resolves.toBeUndefined();
  });

  it("keeps the error when the pull request stayed open", async () => {
    vi.mocked(gitBackend.mergePullRequest).mockRejectedValue(new Error("conflict"));
    vi.mocked(gitBackend.getPullRequestDetails).mockResolvedValue({ state: "OPEN" } as PullRequestDetails);
    await expect(mergeConfirmed("/r", 1, "squash", 0)).rejects.toThrow("conflict");
  });
});
