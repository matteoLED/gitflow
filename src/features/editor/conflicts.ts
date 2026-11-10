/** One conflict in a file: offsets in the text, and the lines of each side (without the markers). */
export type Conflict = {
  /** From the start of the `<<<<<<<` line to the end of the `>>>>>>>` line (its newline included). */
  from: number;
  to: number;
  ours: string;
  base: string | null;
  theirs: string;
  oursLabel: string;
  theirsLabel: string;
};

export type Choice = "ours" | "theirs" | "both";

/** Git's conflict markers (`<<<<<<<`, `|||||||` with diff3, `=======`, `>>>>>>>`), in order of appearance. */
export function parseConflicts(text: string): Conflict[] {
  const conflicts: Conflict[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let open: { from: number; label: string; ours: string[]; base: string[] | null; theirs: string[] | null } | null =
    null;
  let section: "ours" | "base" | "theirs" = "ours";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineEnd = offset + line.length + (i < lines.length - 1 ? 1 : 0);
    if (line.startsWith("<<<<<<<")) {
      open = { from: offset, label: line.slice(7).trim(), ours: [], base: null, theirs: null };
      section = "ours";
    } else if (open && line.startsWith("|||||||") && section === "ours") {
      open.base = [];
      section = "base";
    } else if (open && line.startsWith("=======") && section !== "theirs") {
      open.theirs = [];
      section = "theirs";
    } else if (open && line.startsWith(">>>>>>>") && section === "theirs") {
      conflicts.push({
        from: open.from,
        to: lineEnd,
        ours: open.ours.join("\n"),
        base: open.base ? open.base.join("\n") : null,
        theirs: (open.theirs ?? []).join("\n"),
        oursLabel: open.label,
        theirsLabel: line.slice(7).trim(),
      });
      open = null;
    } else if (open) {
      if (section === "ours") open.ours.push(line);
      else if (section === "base") open.base?.push(line);
      else open.theirs?.push(line);
    }
    offset = lineEnd;
  }
  return conflicts;
}

/** The text replacing a conflict for a choice; it keeps the trailing newline the markers had. */
export function resolution(conflict: Conflict, choice: Choice): string {
  const parts =
    choice === "ours" ? [conflict.ours] : choice === "theirs" ? [conflict.theirs] : [conflict.ours, conflict.theirs];
  const kept = parts.filter((p) => p.length > 0).join("\n");
  return kept ? `${kept}\n` : "";
}
