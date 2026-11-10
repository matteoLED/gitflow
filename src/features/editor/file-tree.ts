export type TreeRow = { path: string; name: string; depth: number; dir: boolean; open: boolean };

type Node = { dirs: Map<string, Node>; files: string[] };

/** Builds the folder tree once per file list. */
export function buildTree(paths: readonly string[]): Node {
  const root: Node = { dirs: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part);
      if (!next) node.dirs.set(part, (next = { dirs: new Map(), files: [] }));
      node = next;
    }
    node.files.push(parts[parts.length - 1]);
  }
  return root;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** The rows on screen: folders first, then files, only inside open folders. */
export function visibleRows(root: Node, open: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (node: Node, prefix: string, depth: number) => {
    for (const name of [...node.dirs.keys()].sort(byName)) {
      const path = prefix + name;
      const isOpen = open.has(path);
      rows.push({ path, name, depth, dir: true, open: isOpen });
      if (isOpen) walk(node.dirs.get(name) as Node, `${path}/`, depth + 1);
    }
    for (const name of [...node.files].sort(byName))
      rows.push({ path: prefix + name, name, depth, dir: false, open: false });
  };
  walk(root, "", 0);
  return rows;
}

/** The folders containing a file, to open them when it's revealed. */
export const parentsOf = (path: string) =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, i, parts) => parts.slice(0, i + 1).join("/"));
