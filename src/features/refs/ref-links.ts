/** A reference found in free text: a pull request, a Linear issue or a commit the app knows about. */
export type Ref = { kind: "pr"; number: number } | { kind: "issue"; id: string } | { kind: "commit"; hash: string };
export type Segment = string | { text: string; ref: Ref };

export type KnownRefs = {
  prs: ReadonlySet<number>;
  /** Linear team keys ("MNT"): an id of a known team is worth a lookup, "UTF-8" isn't. */
  teams: ReadonlySet<string>;
  /** Full hashes of the loaded commits. */
  commits: readonly string[];
};

// Not inside a word, a path, a URL fragment or a colour; whole tokens only.
const PATTERN = /(?<![\w/.#&=-])(?:#(\d{1,6})|([A-Z][A-Z0-9]{1,9})-(\d{1,6})|([0-9a-f]{7,40}))(?![\w-])/g;

function commitOf(token: string, commits: readonly string[]): string | null {
  // An all-digit token is a number, not a hash.
  if (!/[a-f]/.test(token) || !/\d/.test(token)) return null;
  return commits.find((hash) => hash.startsWith(token)) ?? null;
}

function refOf(match: RegExpExecArray, known: KnownRefs): Ref | null {
  const [, pr, team, n, hash] = match;
  if (pr) return known.prs.has(Number(pr)) ? { kind: "pr", number: Number(pr) } : null;
  if (team) return known.teams.has(team) ? { kind: "issue", id: `${team}-${n}` } : null;
  const commit = commitOf(hash, known.commits);
  return commit ? { kind: "commit", hash: commit } : null;
}

/** Splits text around the references it holds; unknown look-alikes stay plain text. */
export function findRefs(text: string, known: KnownRefs): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(PATTERN)) {
    const ref = refOf(match, known);
    if (!ref) continue;
    if (match.index > last) segments.push(text.slice(last, match.index));
    segments.push({ text: match[0], ref });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push(text.slice(last));
  return segments;
}

/** `gitflow-ref:` hrefs carry a reference through Markdown to the link renderer. */
export const REF_SCHEME = "gitflow-ref:";
export const refHref = (ref: Ref) =>
  `${REF_SCHEME}${ref.kind}:${ref.kind === "pr" ? ref.number : ref.kind === "issue" ? ref.id : ref.hash}`;

export function parseRefHref(href: string | undefined): Ref | null {
  if (!href?.startsWith(REF_SCHEME)) return null;
  const [kind, value] = href.slice(REF_SCHEME.length).split(":");
  if (kind === "pr" && /^\d+$/.test(value)) return { kind, number: Number(value) };
  if (kind === "issue" && /^[A-Z][A-Z0-9]*-\d+$/.test(value)) return { kind, id: value };
  if (kind === "commit" && /^[0-9a-f]{7,40}$/.test(value)) return { kind, hash: value };
  return null;
}

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const SKIP = new Set(["a", "code", "pre", "kbd"]);

function linkify(node: HastNode, known: KnownRefs) {
  if (!node.children || (node.tagName && SKIP.has(node.tagName))) return;
  node.children = node.children.flatMap((child): HastNode[] => {
    if (child.type !== "text" || !child.value) {
      linkify(child, known);
      return [child];
    }
    return findRefs(child.value, known).map((s) =>
      typeof s === "string"
        ? { type: "text", value: s }
        : {
            type: "element",
            tagName: "a",
            properties: { href: refHref(s.ref) },
            children: [{ type: "text", value: s.text }],
          },
    );
  });
}

/** Rehype plugin (run after sanitizing): turns known references outside code and links into ref links. */
export const rehypeRefs = (known: KnownRefs) => () => (tree: HastNode) => linkify(tree, known);
