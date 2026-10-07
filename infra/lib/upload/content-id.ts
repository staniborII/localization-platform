/**
 * Identity of one uploaded video, for a single PUT of at most 5 GiB.
 * The file name is not part of it. Two uploads of the same bytes, size, profile, and subtitle languages are one job.
 */

import { createHash } from "node:crypto";

/** Largest object S3 accepts in one PUT. Above this, the upload would have to be multipart. */
export const MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024;

/** Largest media file Amazon Transcribe batch accepts. An MP4 over this needs an audio-only copy. */
export const TRANSCRIBE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** Turns the hex digest the web client computed into the base64 value S3 stores. */
export function sha256HexToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

/** Turns the base64 checksum from S3 back into hex. Returns nothing when it is not a SHA-256 digest. */
export function sha256Base64ToHex(value: string): string | undefined {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32) {
    return undefined;
  }
  return bytes.toString("hex");
}

/** Builds the 64-character key for the duplicate lock. Language order does not change the key. */
export function contentKey(input: { sha256: string; size: number; profile: string; outputs: string[] }): string {
  const material = [input.sha256, String(input.size), input.profile, [...input.outputs].sort().join(",")].join("\n");
  return createHash("sha256").update(material).digest("hex");
}

/** Names the audio-only object. MediaConvert writes `{jobId}.mp3` when the destination has no trailing slash. */
export function audioObjectUris(bucket: string, jobId: string): { destination: string; uri: string } {
  const destination = `s3://${bucket}/audio/${jobId}`;
  return { destination, uri: `${destination}.mp3` };
}
