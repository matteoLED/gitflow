export type Bump = "patch" | "minor" | "major";

type Version = { prefix: string; parts: [number, number, number]; pre: boolean };

const SEMVER = /^(v?)(\d+)\.(\d+)(?:\.(\d+))?([-+].*)?$/;

function parse(tag: string): Version | null {
  const m = SEMVER.exec(tag.trim());
  if (!m) return null;
  return { prefix: m[1], parts: [Number(m[2]), Number(m[3]), Number(m[4] ?? 0)], pre: !!m[5] };
}

/** Higher version first; a release beats its own prereleases. */
function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return b.parts[i] - a.parts[i];
  return Number(a.pre) - Number(b.pre);
}

/** The highest semver-looking tag ("v1.2.3", "2.0", "v1.0.0-rc.1"), or null. */
export function latestVersionTag(tags: readonly string[]): string | null {
  const versions = tags.flatMap((tag) => {
    const v = parse(tag);
    return v ? [{ tag, v }] : [];
  });
  return versions.sort((a, b) => compare(a.v, b.v))[0]?.tag ?? null;
}

/** "v1.2.3" + minor → "v1.3.0". The "v" prefix is kept; a prerelease suffix is dropped. Null if not semver. */
export function bumpVersion(tag: string, bump: Bump): string | null {
  const v = parse(tag);
  if (!v) return null;
  const [major, minor, patch] = v.parts;
  // Bumping a prerelease's own level releases it: 1.3.0-rc.1 → 1.3.0, not 1.3.1.
  const next =
    bump === "major"
      ? [major + 1, 0, 0]
      : bump === "minor"
        ? [major, minor + 1, 0]
        : [major, minor, v.pre ? patch : patch + 1];
  return `${v.prefix}${next.join(".")}`;
}

/** The next patch, minor and major versions after the latest tag (from v0.0.0 when there's none). */
export function nextVersions(tags: readonly string[]): Record<Bump, string> {
  const latest = latestVersionTag(tags) ?? "v0.0.0";
  const bump = (b: Bump) => bumpVersion(latest, b) ?? latest;
  return { patch: bump("patch"), minor: bump("minor"), major: bump("major") };
}
