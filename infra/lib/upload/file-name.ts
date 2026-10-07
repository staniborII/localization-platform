/**
 * Checks that an upload name is an MP4 and reads the profile from its last word.
 * The client copy of this check must stay the same. The presign handler is the gate.
 */

const PROFILE_TOKEN = /^[a-z][a-z0-9-]*$/;

/** Basename safe to store as S3 metadata. The client copy of this file must stay identical. */
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

/**
 * Profile key from the word after the last underscore.
 * `sample_02_interview.mp4` yields `interview`. A bare `notes.mp4` does not.
 */
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
