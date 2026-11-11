import type { LinearRelease, Release, Tag } from "@/types/git";

/** "v1.2.3", "V1.2.3 " and "1.2.3" are the same version. */
const normalize = (version: string) =>
  version
    .trim()
    .toLowerCase()
    .replace(/^v(?=\d)/, "");

export type GithubMatch = { kind: "release"; id: number } | { kind: "tag"; name: string } | null;

/** The GitHub release (else the tag) shipping a Linear release's version (else its name), if any. */
export function matchLinearRelease(
  release: Pick<LinearRelease, "version" | "name">,
  releases: readonly Pick<Release, "id" | "tag_name">[],
  tags: readonly Pick<Tag, "name">[],
): GithubMatch {
  const wanted = normalize(release.version ?? release.name);
  if (!wanted) return null;
  const github = releases.find((r) => normalize(r.tag_name) === wanted);
  if (github) return { kind: "release", id: github.id };
  const tag = tags.find((t) => normalize(t.name) === wanted);
  return tag ? { kind: "tag", name: tag.name } : null;
}
