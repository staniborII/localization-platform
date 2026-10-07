/**
 * Reads a bucket and key from an S3 URI or an S3 HTTPS URL.
 */

/** Accepts s3://, virtual-hosted, and path-style HTTPS URLs. */
export function s3Location(uri: string): { bucket: string; key: string } | undefined {
  const s3 = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (s3?.[1] && s3[2]) {
    return { bucket: s3[1], key: decodeURIComponent(s3[2]) };
  }
  const virtual = /^https:\/\/([^.]+)\.s3[.-][^/]+\.amazonaws\.com\/(.+)$/.exec(uri);
  if (virtual?.[1] && virtual[2]) {
    return { bucket: virtual[1], key: decodeURIComponent(virtual[2]) };
  }
  const pathStyle = /^https:\/\/s3[.-][^/]*amazonaws\.com\/([^/]+)\/(.+)$/.exec(uri);
  if (pathStyle?.[1] && pathStyle[2]) {
    return { bucket: pathStyle[1], key: decodeURIComponent(pathStyle[2]) };
  }
  return undefined;
}
