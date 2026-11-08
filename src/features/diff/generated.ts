/** Files nobody reviews line by line: lockfiles, build output, minified bundles, snapshots, codegen. */
const GENERATED_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "cargo.lock",
  "gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "uv.lock",
  "pubspec.lock",
  "go.sum",
]);
const GENERATED_SUFFIXES = [".min.js", ".min.css", ".map", ".snap", ".pb.go", ".g.dart", ".freezed.dart"];
const GENERATED_DIRS = ["dist/", "build/", "__generated__/", "generated/", "gen/", ".next/", "coverage/"];

export function isGenerated(path: string): boolean {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf("/") + 1);
  return (
    GENERATED_NAMES.has(name) ||
    GENERATED_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    name.includes(".generated.") ||
    GENERATED_DIRS.some((dir) => lower.startsWith(dir) || lower.includes(`/${dir}`))
  );
}
