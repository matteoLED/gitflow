/** Squash-merge convention: "Fix the thing (#1234)". */
const PR_SUFFIX = /\s*\(#(\d+)\)\s*$/;

export function splitSubject(subject: string): { title: string; pr: string | null } {
  const match = PR_SUFFIX.exec(subject);
  return match ? { title: subject.slice(0, match.index), pr: match[1] } : { title: subject, pr: null };
}
