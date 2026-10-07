/**
 * Names the four list pages and builds the addresses that return to them.
 * A section is Upload, Jobs, Gallery, or Failures.
 */

export const sections = ["upload", "jobs", "gallery", "failures"] as const;

export type Section = (typeof sections)[number];

const backLabels: Record<Section, string> = {
  upload: "Back to upload",
  jobs: "Back to jobs",
  gallery: "Back to gallery",
  failures: "Back to failures",
};

/** Accepts a `from` query value only when it names one of the four lists. */
export function sectionFrom(value: string | null): Section | undefined {
  return sections.find((section) => section === value);
}

/** Reads the list page out of a path such as `/gallery` or `/jobs.html`. */
export function sectionFromPath(pathname: string): Section | undefined {
  const bare = pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  return sections.find((section) => bare === `/${section}`);
}

/** Builds `/job?id=` and keeps the list the job was opened from. */
export function jobHref(id: string, section?: Section): string {
  const query = new URLSearchParams({ id });
  if (section) {
    query.set("from", section);
  }
  return `/job?${query.toString()}`;
}

/** Builds the subtitle page and keeps the list the job was opened from. */
export function watchHref(id: string, lang: string, format: "vtt" | "srt", section?: Section): string {
  const query = new URLSearchParams({ id, lang, format });
  if (section) {
    query.set("from", section);
  }
  return `/watch?${query.toString()}`;
}

/** The address and label for returning to a list. A missing section returns to Jobs. */
export function backToList(section?: Section): { href: string; label: string } {
  const chosen = section ?? "jobs";
  return { href: `/${chosen}`, label: backLabels[chosen] };
}

/** The address and label for returning from a subtitle page to its job. */
export function backToJob(id: string, section?: Section): { href: string; label: string } {
  return { href: jobHref(id, section), label: "Back to the job" };
}
