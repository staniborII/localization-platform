/**
 * Calls the web client API on the same hostname as the static site.
 * Local next dev has no API. The CloudFront hostname does.
 * A POST includes x-amz-content-sha256 so CloudFront can sign the body for the function URL.
 */

import { sha256HexOfString } from "@/lib/sha256";

export interface JobOutput {
  lang: string;
  vttKey?: string;
  srtKey?: string;
  vttUrl?: string;
  srtUrl?: string;
}

export interface JobStep {
  id: string;
  title: string;
  detail: string;
  state: "upcoming" | "current" | "done" | "skipped" | "failed";
  at?: string;
}

export interface Job {
  jobId: string;
  status: string;
  profile: string;
  fileName?: string;
  sourceLanguage: string;
  languageConfidence: number | null;
  speakerSaturation: boolean;
  failureReason: string;
  detectedLanguages?: string[];
  outputs: JobOutput[];
  videoUrl?: string;
  updatedAt?: string;
  steps?: JobStep[];
  canContinue?: boolean;
}

export interface UploadTicket {
  uploadUrl: string;
  key: string;
  expiresIn: number;
  headers: Record<string, string>;
}

export interface DuplicateUpload {
  duplicate: true;
  jobId: string;
}

/** Puts the body hash on a POST. CloudFront signs the function URL call with that value. */
async function withPayloadHash(init?: RequestInit): Promise<RequestInit | undefined> {
  if (!init || init.method !== "POST" || typeof init.body !== "string") {
    return init;
  }
  const headers = new Headers(init.headers);
  headers.set("x-amz-content-sha256", sha256HexOfString(init.body));
  return { ...init, headers };
}

/** Fetches one path and turns a failed response into an error the pages can show. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, await withPayloadHash(init));
  } catch {
    throw new Error("The web client API is not reachable. Open this site from the CloudFront hostname after deploy.");
  }
  const body = (await response.json().catch(() => ({}))) as { message?: string; Message?: string };
  if (!response.ok) {
    throw new Error(
      body.message ?? body.Message ?? "The web client API is not reachable. Open this site from the CloudFront hostname after deploy.",
    );
  }
  return body as T;
}

/** Lists recent jobs, or only the jobs in one status. */
export function listJobs(status?: string): Promise<{ jobs: Job[] }> {
  const path = status ? `/api/jobs?status=${encodeURIComponent(status)}` : "/api/jobs";
  return request(path);
}

/** Reads one job, including download links when it has finished. */
export function getJob(id: string): Promise<{ job: Job }> {
  return request(`/api/jobs?id=${encodeURIComponent(id)}`);
}

/** Asks for a short-lived PUT URL, or the job that already holds this file. */
export function requestUpload(
  fileName: string,
  profile: string,
  sha256: string,
  size: number,
): Promise<UploadTicket | DuplicateUpload> {
  return request("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName, profile, sha256, size }),
  });
}

/** Starts a language rerun for a job that needs a choice. */
export function rerunJob(jobId: string, sourceLanguage: string): Promise<{ jobId: string; status: string }> {
  return request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, sourceLanguage }),
  });
}

/** Wakes a run that is still waiting after Transcribe has already finished. */
export function continueWait(jobId: string): Promise<{ jobId: string; status: string }> {
  return request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, continueWait: true }),
  });
}

/** Writes subtitles from the transcript already stored, without starting Transcribe again. */
export function acceptDetected(jobId: string): Promise<{ jobId: string; status: string }> {
  return request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, acceptDetected: true }),
  });
}
