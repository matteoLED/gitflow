import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

export type GraphNode = { id: string; group: string; size: number };
export type GraphLink = { source: string; target: string; weight: number };
export type Placed = GraphNode & { x: number; y: number; r: number };

type SimNode = GraphNode & SimulationNodeDatum & { r: number };

export const radiusOf = (size: number) => Math.min(3 + Math.sqrt(size) * 1.1, 14);

/**
 * A force layout in a `width`×`height` box: files repel, links pull, and each area is drawn toward its
 * own spot on a ring, so a feature's files form one island. Computed in one go (no animation), then
 * scaled to fill the box — nothing gets stuck on the edges. Deterministic: same graph, same picture.
 */
export function layoutGraph(nodes: GraphNode[], links: GraphLink[], width = 1000, height = 640): Placed[] {
  if (nodes.length === 0) return [];
  const groups = [...new Set(nodes.map((d) => d.group))];
  // An ellipse with the box's proportions, so wide panels are used edge to edge.
  const anchor = (g: string) => {
    const angle = (2 * Math.PI * groups.indexOf(g)) / groups.length;
    return groups.length === 1
      ? { x: 0, y: 0 }
      : { x: Math.cos(angle) * width * 0.4, y: Math.sin(angle) * height * 0.4 };
  };
  // Seeded start positions around each area's anchor (d3 would otherwise use a phyllotaxis from 0,0).
  const sim: SimNode[] = nodes.map((d, i) => {
    const a = anchor(d.group);
    return { ...d, r: radiusOf(d.size), x: a.x + ((i * 37) % 60) - 30, y: a.y + ((i * 53) % 60) - 30 };
  });
  const ids = new Set(nodes.map((d) => d.id));
  const edges: (SimulationLinkDatum<SimNode> & { weight: number })[] = links
    .filter((l) => ids.has(l.source) && ids.has(l.target))
    .map((l) => ({ source: l.source, target: l.target, weight: l.weight }));
  const sameGroup = (l: SimulationLinkDatum<SimNode>) => (l.source as SimNode).group === (l.target as SimNode).group;
  forceSimulation(sim)
    .force("charge", forceManyBody<SimNode>().strength(-60).distanceMax(400))
    .force(
      "link",
      forceLink<SimNode, (typeof edges)[number]>(edges)
        .id((d) => d.id)
        .distance((l) => (sameGroup(l) ? 30 : 90))
        .strength((l) => (sameGroup(l) ? 0.4 : 0.04) * Math.min(1, Math.log2(1 + l.weight) / 3)),
    )
    .force("x", forceX<SimNode>((d) => anchor(d.group).x).strength(0.12))
    .force("y", forceY<SimNode>((d) => anchor(d.group).y).strength(0.12))
    .force(
      "collide",
      forceCollide<SimNode>((d) => d.r + 4),
    )
    .stop()
    .tick(320);
  // Fit the drawing into the box, keeping its proportions.
  const margin = 28;
  const xs = sim.map((d) => d.x ?? 0);
  const ys = sim.map((d) => d.y ?? 0);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scaleX = (width - 2 * margin) / (maxX - minX || 1);
  const scaleY = (height - 2 * margin) / (maxY - minY || 1);
  // Keep proportions unless that would leave most of the box empty.
  const scale = Math.min(scaleX, scaleY);
  const offX = (width - (maxX - minX) * scale) / 2;
  const offY = (height - (maxY - minY) * scale) / 2;
  return sim.map(({ id, group, size, r, x, y }) => ({
    id,
    group,
    size,
    r,
    x: offX + ((x ?? 0) - minX) * scale,
    y: offY + ((y ?? 0) - minY) * scale,
  }));
}

/**
 * The area a file belongs to, for colours and islands:
 * "src/features/linear/X.tsx" → "features/linear", "src-tauri/src/git/read.rs" → "rust/git",
 * "apps/platform/src/features/home/X.tsx" → "platform/home", "packages/ui/src/x.ts" → "packages/ui".
 */
export function areaOf(path: string): string {
  const parts = path.split("/");
  if (parts[0] === "src-tauri") return parts.length > 3 ? `rust/${parts[2]}` : "rust";
  if ((parts[0] === "apps" || parts[0] === "packages") && parts.length > 2) {
    const inner = parts.slice(2);
    const feature = inner.indexOf("features");
    if (parts[0] === "apps" && feature >= 0 && inner.length > feature + 2) return `${parts[1]}/${inner[feature + 1]}`;
    return parts[0] === "apps" ? parts[1] : `packages/${parts[1]}`;
  }
  const rest = parts[0] === "src" ? parts.slice(1) : parts;
  if (rest[0] === "features" && rest.length > 2) return `features/${rest[1]}`;
  return rest.length > 1 ? rest[0] : "root";
}
