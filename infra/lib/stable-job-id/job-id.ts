/**
 * The id for one localization job.
 * The same object, profile, and language list always get the same id.
 * A rerun keeps that id. The Transcribe job name adds a suffix such as -f2.
 */

import { createHash } from "node:crypto";

export interface JobIdInput {
  bucket: string;
  key: string;
  etag: string;
  profile: string;
  outputs: string[];
}

/** Builds the id from the bucket, the object key, the etag, the profile,
 *  and the output languages. The same inputs always produce the same 32-character id. */
export function jobId(input: JobIdInput): string {
  const material = [input.bucket, input.key, input.etag, input.profile, [...input.outputs].sort().join(",")].join("\n");
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/** Reads the job id out of a Transcribe job name. The first run is the id alone. 
 * A rerun looks like that id plus -f2. */
export function jobIdFromTranscriptionName(transcriptionJobName: string): string | undefined {
  const match = /^([a-f0-9]{32})(?:-f\d+)?$/.exec(transcriptionJobName);
  return match?.[1];
}
