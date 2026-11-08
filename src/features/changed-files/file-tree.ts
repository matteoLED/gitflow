import type { ChangedFile, FileStatus } from "@/types/git";

export type FileTreeNode =
  | { kind: "dir"; name: string; path: string; children: FileTreeNode[] }
  | { kind: "file"; name: string; path: string; file: ChangedFile };

export type FileTreeRow = { node: FileTreeNode; depth: number };

type DirNode = Extract<FileTreeNode, { kind: "dir" }>;

function insert(root: DirNode, file: ChangedFile): void {
  const segments = file.path.split("/");
  let dir = root;
  segments.slice(0, -1).forEach((name, i) => {
    const path = segments.slice(0, i + 1).join("/");
    let next = dir.children.find((child): child is DirNode => child.kind === "dir" && child.name === name);
    if (!next) {
      next = { kind: "dir", name, path, children: [] };
      dir.children.push(next);
    }
    dir = next;
  });
  dir.children.push({ kind: "file", name: segments[segments.length - 1], path: file.path, file });
}

/** Merges single-child directory chains ("app" > "src" becomes "app/src") and sorts dirs first. */
function compact(node: FileTreeNode): FileTreeNode {
  if (node.kind === "file") return node;
  const only = node.children.length === 1 ? node.children[0] : null;
  if (only?.kind === "dir" && node.path !== "") {
    return compact({ ...only, name: `${node.name}/${only.name}` });
  }
  const children = node.children
    .map(compact)
    .sort((a, b) => Number(a.kind === "file") - Number(b.kind === "file") || a.name.localeCompare(b.name));
  return { ...node, children };
}

export function buildFileTree(files: ChangedFile[]): FileTreeNode[] {
  const root: DirNode = { kind: "dir", name: "", path: "", children: [] };
  files.forEach((file) => insert(root, file));
  return (compact(root) as DirNode).children;
}

/** Visible rows in display order, skipping children of collapsed directories. */
export function flattenTree(nodes: FileTreeNode[], collapsed: ReadonlySet<string>, depth = 0): FileTreeRow[] {
  return nodes.flatMap((node) => {
    const row = { node, depth };
    if (node.kind === "file" || collapsed.has(node.path)) return [row];
    return [row, ...flattenTree(node.children, collapsed, depth + 1)];
  });
}

export type FileListRow =
  { kind: "header"; key: string; status: FileStatus; count: number } | (FileTreeRow & { kind: "row"; key: string });

const STATUS_ORDER: FileStatus[] = ["added", "modified", "renamed", "copied", "deleted", "unmerged", "untracked"];

type RowOptions = { mode: "tree" | "list"; grouping: "none" | "status"; collapsed: ReadonlySet<string> };

function sectionRows(files: ChangedFile[], section: string, { mode, collapsed }: RowOptions): FileListRow[] {
  const prefix = `${section}:`;
  const rows: FileTreeRow[] =
    mode === "list"
      ? [...files]
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((file) => ({
            node: { kind: "file", name: file.path.slice(file.path.lastIndexOf("/") + 1), path: file.path, file },
            depth: 0,
          }))
      : flattenTree(
          buildFileTree(files),
          new Set([...collapsed].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))),
        );
  return rows.map((row) => ({ ...row, kind: "row", key: prefix + row.node.path }));
}

/** Rows of the changed-files panel: tree or flat list, optionally grouped under status headers. Keys are `section:path`. */
export function buildFileRows(files: ChangedFile[], options: RowOptions): FileListRow[] {
  if (options.grouping === "none") return sectionRows(files, "all", options);
  return STATUS_ORDER.flatMap((status) => {
    const group = files.filter((f) => f.status === status);
    if (group.length === 0) return [];
    const header: FileListRow = {
      kind: "header",
      key: `header:${status}`,
      status,
      count: group.length,
    };
    return [header, ...sectionRows(group, status, options)];
  });
}
