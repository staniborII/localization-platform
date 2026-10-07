/**
 * Labels for the three content profiles shown on the upload form and the job list.
 * A profile that is not listed here still uploads when the stage config knows it.
 */

export const profileCopy: Record<string, { label: string; detail: string }> = {
  highlights: { label: "Highlights", detail: "No speaker labels" },
  interview: { label: "Interview", detail: "Up to 3 speakers" },
  feature: { label: "Feature", detail: "Up to 6 speakers" },
};

/** Returns the label for a known profile, or the raw id when the stage added a new one. */
export function describeProfile(id: string): { label: string; detail: string } {
  return (
    profileCopy[id] ?? {
      label: id,
      detail: "Accepted when this profile exists in the stage config.",
    }
  );
}
