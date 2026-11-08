import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./workspace-store";

const repo = (name: string) => ({ path: `/code/${name}`, name });
const state = () => useWorkspaceStore.getState();
const openAll = (...names: string[]) => names.forEach((name) => state().openRepo(repo(name)));

describe("open repositories", () => {
  beforeEach(() => useWorkspaceStore.setState({ repo: null, repos: [], recentRepos: [], sessions: {} }));

  it("keeps the opening order and no duplicates", () => {
    openAll("a", "b", "a");
    expect(state().repos.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("makes the last opened repository active", () => {
    openAll("a", "b");
    expect(state().repo?.name).toBe("b");
  });

  it("restores a repository's selection when switching back to it", () => {
    openAll("a");
    state().selectCommit("abc123");
    openAll("b");
    state().switchRepo("/code/a");
    expect(state().selectedCommitHash).toBe("abc123");
  });

  it("starts a newly opened repository with no selection", () => {
    openAll("a");
    state().selectCommit("abc123");
    openAll("b");
    expect(state().selectedCommitHash).toBeNull();
  });

  it("moves to the neighbour when the active repository is closed", () => {
    openAll("a", "b", "c");
    state().switchRepo("/code/b");
    state().closeRepo("/code/b");
    expect(state().repo?.name).toBe("c");
  });

  it("shows the welcome screen once the last repository is closed", () => {
    openAll("a");
    state().closeRepo("/code/a");
    expect(state().repo).toBeNull();
  });

  it("keeps a closed repository in the history", () => {
    openAll("a", "b");
    state().closeRepo("/code/a");
    expect(state().recentRepos.map((r) => r.name)).toEqual(["b", "a"]);
  });

  it("forgets a repository from the history", () => {
    openAll("a");
    state().closeRepo("/code/a");
    state().forgetRecent("/code/a");
    expect(state().recentRepos).toEqual([]);
  });
});
