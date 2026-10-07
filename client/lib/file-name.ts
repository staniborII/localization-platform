/**
 * Reads the profile from an MP4 name before upload.
 * Keep this check identical to infra/lib/upload/file-name.ts.
 */

const PROFILE_TOKEN = /^[a-z][a-z0-9-]*$/;

/** Keep identical to infra/lib/upload/file-name.ts. The presign function is the gate. */
export function cleanedFileName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const base = value.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 120);
  if (!cleaned.toLowerCase().endsWith(".mp4")) {
    return undefined;
  }
  return cleaned;
}

/** `sample_02_interview.mp4` yields `interview`. A bare `notes.mp4` does not. */
export function profileFromFileName(value: unknown): string | undefined {
  const cleaned = cleanedFileName(value);
  if (!cleaned) {
    return undefined;
  }
  const stem = cleaned.slice(0, -".mp4".length);
  const underscore = stem.lastIndexOf("_");
  if (underscore < 0) {
    return undefined;
  }
  const token = stem.slice(underscore + 1).toLowerCase();
  return PROFILE_TOKEN.test(token) ? token : undefined;
}

export const FILE_NAME_HINT =
  "Use an MP4 named like sample_02_interview.mp4. The word after the last underscore is the profile.";
