import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App, createQueryClient } from "./App";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useUiStore } from "@/stores/ui-store";
import { useHistorySearchStore } from "@/features/history/history-search-store";
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
    amendCommit: vi.fn(),
    headMessage: vi.fn(),
    switchBranch: vi.fn(),
    createBranch: vi.fn(),
    fetch: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
    submitReview: vi.fn(),
    getPullRequestDetails: vi.fn(),
    watchRepository: vi.fn().mockResolvedValue(null),
    getGithubWebUrl: vi.fn(),
    detectAgents: vi.fn(),
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
    { name: "main", upstream: "origin/main", upstreamGone: false, ahead: 1, behind: 0, committedAt: "", subject: "" },
    { name: "feature/login", upstream: null, upstreamGone: false, ahead: 0, behind: 0, committedAt: "", subject: "" },
  ],
  remotes: [{ remote: "origin", name: "main", committedAt: "" }],
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
  it("offers to open one", async () => {
    useWorkspaceStore.setState({ repo: null });
    renderApp();
    // The welcome screen is lazy-loaded: its first import can outlast findBy's 1 s while other files run.
    expect(await screen.findByRole("button", { name: "Open repository…" }, { timeout: 5000 })).toBeInTheDocument();
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

  it("searches the whole history through git log", async () => {
    renderApp();
    await within(await commitList()).findByText("Commit number 1");
    // Focus directly: with 0×0 jsdom rects, the panel group treats any click as a separator drag.
    screen.getByRole("searchbox", { name: "Search history" }).focus();
    await userEvent.keyboard("author:mat fix");
    await waitFor(() =>
      expect(backend.listCommits).toHaveBeenLastCalledWith(
        REPO.path,
        expect.objectContaining({ filters: expect.objectContaining({ author: "mat", message: "fix" }) }),
      ),
    );
    useHistorySearchStore.getState().setQuery("", true);
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
    await userEvent.click(await screen.findByRole("button", { name: /^Pull(?! requests)/ }));
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

  it("amends the last commit, starting from its message", async () => {
    backend.headMessage.mockResolvedValue("Previous message");
    renderApp();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Amend" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Commit message" })).toHaveValue("Previous message"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Amend last commit" }));
    expect(backend.amendCommit).toHaveBeenCalledWith(REPO.path, "Previous message");
  });

  it("won't amend a commit its upstream already has", async () => {
    backend.listRefs.mockResolvedValue({ ...REFS, branches: [{ ...REFS.branches[0], ahead: 0 }] });
    renderApp();
    expect(await screen.findByRole("checkbox", { name: "Amend" })).toBeDisabled();
  });
});

describe("settings", () => {
  beforeEach(() => useUiStore.setState({ settingsOpen: false }));

  it("opens full-window with ⌘,", async () => {
    renderApp();
    await userEvent.keyboard("{Meta>},{/Meta}");
    expect(await screen.findByRole("dialog", { name: "Profile" })).toBeInTheDocument();
  });

  it("shows the page picked in the sidebar", async () => {
    useUiStore.setState({ settingsOpen: true });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("returns to the app with Escape", async () => {
    useUiStore.setState({ settingsOpen: true });
    renderApp();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("pull request review", () => {
  const PR = {
    number: 42,
    title: "Add login",
    author: "ana",
    base: "b".repeat(40),
    head: COMMITS[0].hash,
    url: "https://github.com/o/r/pull/42",
  };

  beforeEach(() => {
    useWorkspaceStore.getState().openPullRequest(PR, `origin/main..${PR.head}`);
    backend.submitReview.mockResolvedValue(null);
    backend.getGithubWebUrl.mockResolvedValue("https://github.com/o/r");
    backend.detectAgents.mockResolvedValue([]);
    backend.listCommitFiles.mockResolvedValue([FILE]);
    backend.getPullRequestDetails.mockReturnValue(new Promise(() => {}));
  });

  /** The page opens on its overview; the review happens on the Diff tab. */
  const renderDiff = async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("tab", { name: "Diff" }));
  };

  it("folds a file once it is marked as reviewed", async () => {
    await renderDiff();
    await userEvent.click(await screen.findByRole("checkbox"));
    expect(await screen.findByText("1/1 reviewed")).toBeInTheDocument();
  });

  it("compares the pull request head with its merge-base", async () => {
    await renderDiff();
    await waitFor(() => expect(backend.listCommitFiles).toHaveBeenCalledWith(REPO.path, PR.head, PR.base));
  });

  it("approves the pull request through gh", async () => {
    await renderDiff();
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    await userEvent.click(screen.getByRole("radio", { name: /Approve/ }));
    await userEvent.click(screen.getByRole("button", { name: "Submit review" }));
    expect(backend.submitReview).toHaveBeenCalledWith(REPO.path, 42, "approve", "");
  });
});
