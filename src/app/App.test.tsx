import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App, createQueryClient } from "./App";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useNoticesStore } from "@/stores/notices-store";
import { gitBackend } from "@/lib/tauri-git";
import type { ChangedFile, CommitSummary, RefsSnapshot, WorkingTreeEntry } from "@/types/git";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/lib/tauri-git", () => ({
  gitBackend: {
    openRepository: vi.fn(),
    listRefs: vi.fn(),
    listCommits: vi.fn(),
    listCommitFiles: vi.fn(),
    getCommitDiff: vi.fn(),
    getWorkingTree: vi.fn(),
    getWorkingDiff: vi.fn(),
    getAvatarUrl: vi.fn(),
    stageFiles: vi.fn(),
    unstageFiles: vi.fn(),
    createCommit: vi.fn(),
    switchBranch: vi.fn(),
    createBranch: vi.fn(),
    fetch: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
  },
}));

const backend = vi.mocked(gitBackend);
const REPO = { path: "/tmp/demo", name: "demo" };

const commit = (n: number): CommitSummary => ({
  hash: `${n}`.padStart(40, "a"),
  parents: [],
  subject: `Commit number ${n}`,
  author: "Ana",
  authorEmail: "ana@example.com",
  coAuthors: [],
  authoredAt: "2026-11-01T10:00:00Z",
  refs: [],
});
const COMMITS = [1, 2, 3].map(commit);

const REFS: RefsSnapshot = {
  head: { branch: "main", unborn: false },
  branches: [
    { name: "main", upstream: "origin/main", upstreamGone: false, ahead: 1, behind: 0 },
    { name: "feature/login", upstream: null, upstreamGone: false, ahead: 0, behind: 0 },
  ],
  remotes: [{ remote: "origin", name: "main" }],
  tags: [],
  stashes: [],
};

const FILE: ChangedFile = {
  path: "src/app.ts",
  previousPath: null,
  status: "modified",
  binary: false,
  additions: 1,
  deletions: 0,
};
const UNSTAGED: WorkingTreeEntry = {
  path: "notes.md",
  previousPath: null,
  staged: null,
  unstaged: "modified",
  conflicted: false,
};

// jsdom has no layout: give the virtualized list a viewport and stub observers.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 400 });

const renderApp = () => render(<App client={createQueryClient()} />);
const commitList = () => screen.findByRole("listbox", { name: /commits on/i });

beforeEach(() => {
  vi.clearAllMocks();
  useNoticesStore.setState({ notices: [] });
  useWorkspaceStore.setState({
    repo: REPO,
    view: "history",
    historyRev: null,
    selectedCommitHash: null,
    selectedFilePath: null,
    selectedChange: null,
  });
  backend.listRefs.mockResolvedValue(REFS);
  backend.listCommits.mockResolvedValue(COMMITS);
  backend.listCommitFiles.mockResolvedValue([FILE]);
  backend.getCommitDiff.mockResolvedValue({ patch: "@@ -1 +1 @@\n-old\n+new", binary: false });
  backend.getWorkingTree.mockResolvedValue([UNSTAGED]);
  backend.getAvatarUrl.mockResolvedValue(null);
  backend.getWorkingDiff.mockResolvedValue({ patch: "@@ -1 +1 @@\n-a\n+b", binary: false });
});

describe("without a repository", () => {
  it("offers to open one", () => {
    useWorkspaceStore.setState({ repo: null });
    renderApp();
    expect(screen.getByRole("button", { name: "Open repository…" })).toBeInTheDocument();
  });
});

describe("history view", () => {
  it("lists commits from the backend", async () => {
    renderApp();
    expect(await within(await commitList()).findByText("Commit number 2")).toBeInTheDocument();
  });

  it("lists the files of a clicked commit", async () => {
    renderApp();
    await userEvent.click(await within(await commitList()).findByText("Commit number 1"));
    expect(await screen.findByRole("option", { name: /app\.ts/ })).toBeInTheDocument();
  });

  it("renders the diff of the commit's files", async () => {
    renderApp();
    await userEvent.click(await within(await commitList()).findByText("Commit number 1"));
    expect(await screen.findByText("new")).toBeInTheDocument();
  });

  it("moves the commit selection with the arrow keys", async () => {
    renderApp();
    const list = await commitList();
    await within(list).findByText("Commit number 1");
    list.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(useWorkspaceStore.getState().selectedCommitHash).toBe(COMMITS[1].hash);
  });

  it("shows an empty state when the filter matches nothing", async () => {
    renderApp();
    await within(await commitList()).findByText("Commit number 1");
    // Focus directly: with 0×0 jsdom rects, the panel group treats any click as a separator drag.
    screen.getByRole("searchbox", { name: "Filter commits" }).focus();
    await userEvent.keyboard("zzz-no-match");
    expect(screen.getByText("No matching commits")).toBeInTheDocument();
  });

  it("asks for the history of a branch when it is clicked", async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: /^login/ }));
    expect(backend.listCommits).toHaveBeenLastCalledWith(REPO.path, {
      rev: "feature/login",
      skip: 0,
      limit: 200,
      filters: { firstParent: false, noMerges: false },
    });
  });
});

describe("operations", () => {
  it("pulls through the backend", async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: /^Pull/ }));
    expect(backend.pull).toHaveBeenCalledWith(REPO.path);
  });

  it("reports a failed switch with Git's reason", async () => {
    backend.switchBranch.mockRejectedValue({
      kind: "commandFailed",
      message: "Your local changes would be overwritten by checkout",
      detail: null,
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Switch to feature/login" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your local changes would be overwritten");
  });
});

describe("changes view", () => {
  beforeEach(() => useWorkspaceStore.setState({ view: "changes" }));

  it("stages a file through the backend", async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Stage notes.md" }));
    expect(backend.stageFiles).toHaveBeenCalledWith(REPO.path, ["notes.md"]);
  });

  it("disables committing while nothing is staged", async () => {
    renderApp();
    expect(await screen.findByRole("button", { name: "Stage files to commit" })).toBeDisabled();
  });

  it("commits staged files with the typed message", async () => {
    backend.getWorkingTree.mockResolvedValue([{ ...UNSTAGED, staged: "modified", unstaged: null }]);
    renderApp();
    const message = await screen.findByRole("textbox", { name: "Commit message" });
    message.focus();
    await userEvent.keyboard("Fix typo");
    await userEvent.click(await screen.findByRole("button", { name: "Commit 1 file" }));
    expect(backend.createCommit).toHaveBeenCalledWith(REPO.path, "Fix typo");
  });
});
