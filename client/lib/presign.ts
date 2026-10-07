/**
 * Keeps a presigned video link stable while the job page polls.
 * The link carries the time it was signed and how many seconds it lasts.
 */

interface HeldOutput {
  vttUrl?: string;
  srtUrl?: string;
}

interface HeldJob<TOutput extends HeldOutput> {
  videoUrl?: string;
  outputs: TOutput[];
}

/** The moment the link stops working, in milliseconds, or undefined when the link has no expiry. */
export function presignExpiry(url: string): number | undefined {
  let query: URLSearchParams;
  try {
    query = new URL(url).searchParams;
  } catch {
    return undefined;
  }
  const date = query.get("X-Amz-Date");
  const expires = Number(query.get("X-Amz-Expires"));
  const match = date ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date) : null;
  if (!match || !Number.isFinite(expires)) {
    return undefined;
  }
  const signedAt = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return signedAt + expires * 1000;
}

/** True when the link is past its signing window, with a few seconds of clock skew. */
export function presignExpired(url: string, now = Date.now()): boolean {
  const expiry = presignExpiry(url);
  if (expiry === undefined) {
    return false;
  }
  return now >= expiry - 15_000;
}

/** Keeps the video and subtitle links already on screen. A later poll does not replace them. */
export function holdJobMedia<TOutput extends HeldOutput, TJob extends HeldJob<TOutput>>(
  previous: TJob | undefined,
  next: TJob,
): TJob {
  if (!previous?.videoUrl) {
    return next;
  }
  const keepOutputs = previous.outputs.some((output) => output.vttUrl || output.srtUrl);
  return {
    ...next,
    videoUrl: previous.videoUrl,
    outputs: keepOutputs ? previous.outputs : next.outputs,
  };
}
