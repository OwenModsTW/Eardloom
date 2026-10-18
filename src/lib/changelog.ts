import raw from "../../CHANGELOG.md?raw";

export interface Release {
  version: string;
  /** First line of the section: a one-sentence summary. */
  summary: string;
  /** Everything else, as Markdown. */
  body: string;
}

/** Releases bundled with this build, newest first. */
export const RELEASES: Release[] = raw
  .split(/^## /m)
  .slice(1)
  .map((section) => {
    const [heading, ...rest] = section.split("\n");
    const text = rest.join("\n").trim();
    const [summary, ...body] = text.split(/\n\s*\n/);
    return { version: heading.trim(), summary: summary?.trim() ?? "", body: body.join("\n\n").trim() };
  });

/** -1, 0 or 1, comparing dotted version numbers. */
export function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Releases newer than `from`, up to and including `to`. */
export const releasesBetween = (from: string, to: string) =>
  RELEASES.filter((r) => compareVersions(r.version, from) > 0 && compareVersions(r.version, to) <= 0);
