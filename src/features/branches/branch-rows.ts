import type { LocalBranch, RefsSnapshot } from "@/types/git";

export type Section = "remotes" | "tags" | "stashes";

/** One line of the branch list, flattened so the list can be virtualized whatever the repository's size. */
export type BranchListRow =
  | { kind: "group"; key: string; prefix: string; count: number; open: boolean }
  | { kind: "branch"; key: string; branch: LocalBranch; label: string; indent: boolean }
  | { kind: "section"; key: string; section: Section; count: number; open: boolean }
  | { kind: "rev"; key: string; rev: string }
  | { kind: "stash"; key: string; message: string }
  | { kind: "empty"; key: string; reason: "none" | "noMatch" | "noOther" };

/** Branches by the prefix before their first "/" (unprefixed first); one pass, no copying. */
export function groupByPrefix(branches: LocalBranch[]): [string | null, LocalBranch[]][] {
  const groups = new Map<string | null, LocalBranch[]>();
  for (const branch of branches) {
    const slash = branch.name.indexOf("/");
    const key = slash > 0 ? branch.name.slice(0, slash) : null;
    const list = groups.get(key);
    if (list) list.push(branch);
    else groups.set(key, [branch]);
  }
  return [...groups].sort(([a], [b]) => Number(a !== null) - Number(b !== null));
}

/**
 * Prefix groups start open and sections (remotes, tags, stashes) closed; `toggled` holds the keys the user
 * flipped. A filter flattens the branches and opens the sections that have matches.
 */
export function branchRows(refs: RefsSnapshot, query: string, toggled: ReadonlySet<string>): BranchListRow[] {
  const needle = query.toLowerCase();
  const match = (text: string) => !needle || text.toLowerCase().includes(needle);
  const rows: BranchListRow[] = [];
  const others = refs.branches.filter((b) => b.name !== refs.head.branch && match(b.name));
  if (others.length === 0) rows.push({ kind: "empty", key: "empty:branches", reason: needle ? "noMatch" : "noOther" });
  if (needle) {
    for (const b of others) rows.push({ kind: "branch", key: `b:${b.name}`, branch: b, label: b.name, indent: false });
  } else {
    for (const [prefix, branches] of groupByPrefix(others)) {
      if (prefix === null) {
        for (const b of branches)
          rows.push({ kind: "branch", key: `b:${b.name}`, branch: b, label: b.name, indent: false });
        continue;
      }
      const key = `group:${prefix}`;
      const open = !toggled.has(key);
      rows.push({ kind: "group", key, prefix, count: branches.length, open });
      if (open)
        for (const b of branches)
          rows.push({
            kind: "branch",
            key: `b:${b.name}`,
            branch: b,
            label: b.name.slice(prefix.length + 1),
            indent: true,
          });
    }
  }
  const remotes = refs.remotes.map((r) => `${r.remote}/${r.name}`).filter(match);
  const tags = refs.tags.filter(match);
  const stashes = needle ? [] : refs.stashes;
  const sections: [Section, BranchListRow[]][] = [
    ["remotes", remotes.map((rev) => ({ kind: "rev", key: `r:${rev}`, rev }))],
    ["tags", tags.map((rev) => ({ kind: "rev", key: `t:${rev}`, rev }))],
    ["stashes", stashes.map((s) => ({ kind: "stash", key: `s:${s.index}`, message: s.message }))],
  ];
  for (const [section, children] of sections) {
    if (needle && children.length === 0) continue;
    const key = `section:${section}`;
    const open = needle ? true : toggled.has(key);
    rows.push({ kind: "section", key, section, count: children.length, open });
    // Closed sections render nothing: a big repository has thousands of remote branches.
    if (open)
      rows.push(
        ...(children.length
          ? children
          : [{ kind: "empty" as const, key: `empty:${section}`, reason: "none" as const }]),
      );
  }
  return rows;
}
