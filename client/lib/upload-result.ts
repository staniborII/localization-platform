/**
 * Turns a rejected video upload into the sentence shown on the upload page.
 * S3 answers a failed PUT with a short XML error, not the page's own JSON.
 */

const knownReasons: Record<string, string> = {
  SignatureDoesNotMatch: "The upload link was rejected. Choose the file and try again.",
  AccessDenied: "The upload link was rejected. Choose the file and try again.",
  ExpiredToken: "The upload link expired before the file finished. Choose the file and try again.",
  RequestTimeout: "The upload timed out before the file finished. Try again.",
  XAmzContentChecksumMismatch: "The file did not match the checksum sent with it.",
  BadDigest: "The file did not match the checksum sent with it.",
  EntityTooLarge: "This file is larger than 5 GB. One upload can be at most 5 GB.",
};

/** Reads the S3 error code and message out of a rejected PUT. */
export function reasonFromUploadBody(status: number, body: string): string {
  const code = /<Code>\s*([^<]+?)\s*<\/Code>/.exec(body)?.[1] ?? "";
  const known = knownReasons[code];
  if (known) {
    return known;
  }
  const message = /<Message>\s*([^<]+?)\s*<\/Message>/.exec(body)?.[1] ?? "";
  if (message && message.length <= 240) {
    return code ? `${message} (${code})` : message;
  }
  if (code) {
    return `The video upload was rejected (${code}).`;
  }
  return `The video upload was rejected (${status}).`;
}
