import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { BranchSidebar } from "@/features/branches/BranchSidebar";
import { CommitList } from "@/features/history/CommitList";
import { ChangedFilesPanel } from "@/features/changed-files/ChangedFilesPanel";
import { DiffPanel } from "@/features/diff/DiffPanel";
import { ChangesPanel } from "@/features/working-tree/ChangesPanel";
import { WorkingDiffPanel } from "@/features/working-tree/WorkingDiffPanel";
import { WelcomeScreen } from "@/features/repositories/WelcomeScreen";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { RepositoryInfo } from "@/types/git";

function ResizeHandle() {
  return (
    <Separator className="w-px bg-border transition-colors data-[separator=active]:bg-primary data-[separator=hover]:bg-primary/60" />
  );
}

function HistoryLayout({ repo }: { repo: RepositoryInfo }) {
  const layout = useDefaultLayout({ id: "history-columns", storage: localStorage });
  return (
    <Group
      orientation="horizontal"
      className="h-full"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <Panel id="branches" defaultSize="17" minSize={200} maxSize="30">
        <BranchSidebar repo={repo} />
      </Panel>
      <ResizeHandle />
      <Panel id="history" defaultSize="22" minSize={260}>
        <CommitList repoPath={repo.path} />
      </Panel>
      <ResizeHandle />
      <Panel id="files" defaultSize="19" minSize={200}>
        <ChangedFilesPanel repoPath={repo.path} />
      </Panel>
      <ResizeHandle />
      <Panel id="diff" defaultSize="42" minSize={320}>
        <DiffPanel repoPath={repo.path} />
      </Panel>
    </Group>
  );
}

function ChangesLayout({ repo }: { repo: RepositoryInfo }) {
  const layout = useDefaultLayout({ id: "changes-columns", storage: localStorage });
  return (
    <Group
      orientation="horizontal"
      className="h-full"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <Panel id="branches" defaultSize="17" minSize={200} maxSize="30">
        <BranchSidebar repo={repo} />
      </Panel>
      <ResizeHandle />
      <Panel id="changes" defaultSize="28" minSize={260}>
        <ChangesPanel repoPath={repo.path} />
      </Panel>
      <ResizeHandle />
      <Panel id="working-diff" defaultSize="55" minSize={320}>
        <WorkingDiffPanel repoPath={repo.path} />
      </Panel>
    </Group>
  );
}

export function AppShell() {
  const { repo, view } = useWorkspaceStore();
  if (!repo) return <WelcomeScreen />;
  // Keyed by path: switching repository resets every panel's local state.
  return view === "changes" ? (
    <ChangesLayout key={repo.path} repo={repo} />
  ) : (
    <HistoryLayout key={repo.path} repo={repo} />
  );
}
