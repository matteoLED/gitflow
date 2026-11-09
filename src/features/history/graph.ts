/** Commit graph lanes, computed over the loaded page of history (children before parents, as `git log` lists them). */

export type Segment = { from: number; to: number; part: "top" | "bottom"; color: number };
export type GraphRow = { col: number; color: number; segments: Segment[]; lanes: number };

type Commit = { hash: string; parents: string[] };

export function buildGraph(commits: Commit[]): GraphRow[] {
  let lanes: (string | null)[] = [];
  let colors: number[] = [];
  let nextColor = 0;
  const freeSlot = (taken: (string | null)[], avoid: number) => {
    const index = taken.findIndex((lane, i) => lane === null && i !== avoid);
    return index === -1 ? taken.length : index;
  };

  return commits.map((commit) => {
    const top = lanes;
    let col = top.indexOf(commit.hash);
    if (col === -1) col = freeSlot(top, -1);
    const next = [...top];
    const nextColors = [...colors];
    if (nextColors[col] === undefined || top[col] !== commit.hash) nextColors[col] = nextColor++;
    const color = nextColors[col];
    const segments: Segment[] = [];

    // Lines coming from above: into this commit, or passing by.
    top.forEach((lane, i) => {
      if (lane === null) return;
      if (lane === commit.hash) {
        segments.push({ from: i, to: col, part: "top", color: colors[i] });
        if (i !== col) next[i] = null;
      } else {
        segments.push(
          { from: i, to: i, part: "top", color: colors[i] },
          { from: i, to: i, part: "bottom", color: colors[i] },
        );
      }
    });

    // Lines leaving towards the parents: the first keeps this lane, the others join or open one.
    next[col] = commit.parents[0] ?? null;
    if (commit.parents[0]) segments.push({ from: col, to: col, part: "bottom", color });
    for (const parent of commit.parents.slice(1)) {
      let lane = next.indexOf(parent);
      if (lane === -1) {
        lane = freeSlot(next, col);
        next[lane] = parent;
        nextColors[lane] = nextColor++;
      }
      segments.push({ from: col, to: lane, part: "bottom", color: nextColors[lane] });
    }

    while (next.length && next[next.length - 1] === null) next.pop();
    lanes = next;
    colors = nextColors.slice(0, Math.max(next.length, col + 1));
    return { col, color, segments, lanes: Math.max(top.length, next.length, col + 1) };
  });
}
