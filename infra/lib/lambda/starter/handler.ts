/**
 * Starts one localization job when a video lands in the video upload bucket.
 * The same bytes, size, profile, and subtitle languages do not start a second job.
 */

import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ExecutionAlreadyExists, SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { readConfig } from "../../shared/runtime-config";
import { jobId } from "../../stable-job-id/job-id";
import { executionInput } from "../../transcription/build-transcription-input";
import { MAX_SINGLE_PUT_BYTES, audioObjectUris, contentKey, sha256Base64ToHex } from "../../upload/content-id";
import { documentClient } from "../dynamodb";
import { required } from "../required-variable";

const s3 = new S3Client({});
const steps = new SFNClient({});

interface ObjectCreated {
  detail?: {
    bucket?: { name?: string };
    object?: { key?: string; etag?: string };
  };
}

/** Decodes the S3 object key from the event. */
function objectKey(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  return decodeURIComponent(raw.replace(/\+/g, " "));
}

/** Writes the job row and starts the state machine. An unknown profile, a missing checksum, or a file over 5 GB is stored as failed and does not start. */
export async function handler(event: ObjectCreated): Promise<void> {
  const bucket = event.detail?.bucket?.name;
  const key = objectKey(event.detail?.object?.key);
  const etag = event.detail?.object?.etag?.replaceAll('"', "");
  if (!bucket || !key || !etag) {
    return;
  }
  const parts = key.split("/");
  if (parts.length !== 3 || parts[0] !== "video-upload" || !parts[2]?.toLowerCase().endsWith(".mp4")) {
    return;
  }

  const config = readConfig();
  const profileName = parts[1] ?? "";
  const profile = config.profiles[profileName];
  const id = jobId({ bucket, key, etag, profile: profileName, outputs: config.languages.outputs });
  const now = new Date().toISOString();
  const tableName = required("TABLE_NAME");
  let fileName = parts[2];
  let size = 0;
  let sha256 = "";
  let fullObject = true;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }));
    if (head.Metadata?.filename) {
      fileName = head.Metadata.filename;
    }
    size = head.ContentLength ?? 0;
    sha256 = head.ChecksumSHA256 ? (sha256Base64ToHex(head.ChecksumSHA256) ?? "") : "";
    fullObject = !head.ChecksumType || head.ChecksumType === "FULL_OBJECT";
  } catch (error) {
    console.error("object metadata was not readable", error instanceof Error ? error.message : "head failed");
    throw error;
  }

  const base = {
    jobId: id,
    listPk: "job",
    profile: profileName,
    bucket,
    objectKey: key,
    etag,
    fileName,
    targetLanguages: config.languages.outputs,
    createdAt: now,
    updatedAt: now,
  };

  if (!profile) {
    await putOnce(tableName, {
      ...base,
      status: "failed",
      failureReason: `Unknown profile "${profileName}"`,
      mode: "highlights",
      transcriptionJobName: id,
      transcriptKey: `transcripts/${id}.json`,
    });
    return;
  }

  if (!sha256 || size < 1 || !fullObject) {
    await putOnce(tableName, {
      ...base,
      status: "failed",
      failureReason: fullObject
        ? "The upload did not include a checksum of the whole file."
        : "This upload is not a single part, so its checksum cannot identify the file.",
      mode: "highlights",
      objectSize: size,
      transcriptionJobName: id,
      transcriptKey: `transcripts/${id}.json`,
    });
    return;
  }

  if (size > MAX_SINGLE_PUT_BYTES) {
    await putOnce(tableName, {
      ...base,
      status: "failed",
      failureReason: "This file is larger than 5 GB. One upload can be at most 5 GB.",
      mode: "highlights",
      objectSize: size,
      transcriptionJobName: id,
      transcriptKey: `transcripts/${id}.json`,
    });
    return;
  }

  const lockId = contentKey({ sha256, size, profile: profileName, outputs: config.languages.outputs });
  const claimed = await claimContent(tableName, lockId, id);
  if (!claimed) {
    return;
  }

  const audio = audioObjectUris(required("TRANSCRIPT_SUBTITLE_BUCKET"), id);
  const input = executionInput({
    jobId: id,
    profile: profileName,
    profileSettings: profile,
    bucket,
    key,
    targetLanguages: config.languages.outputs,
    transcriptionJobName: id,
    objectSize: size,
    audioDestination: audio.destination,
    audioUri: audio.uri,
  });
  const created = await putOnce(tableName, {
    ...base,
    status: "received",
    mode: input.mode,
    maxSpeakers: input.maxSpeakers,
    objectSize: size,
    contentSha256: sha256,
    transcriptionJobName: input.transcriptionJobName,
    transcriptKey: input.transcriptKey,
    executionName: id,
  });
  if (!created) {
    const existing = await documentClient().send(new GetCommand({ TableName: tableName, Key: { jobId: id }, ConsistentRead: true }));
    if (existing.Item?.status !== "received") {
      return;
    }
  }

  try {
    await steps.send(
      new StartExecutionCommand({
        stateMachineArn: required("STATE_MACHINE_ARN"),
        name: id,
        input: JSON.stringify(input),
      }),
    );
  } catch (error) {
    if (error instanceof ExecutionAlreadyExists || (error instanceof Error && error.name === "ExecutionAlreadyExists")) {
      return;
    }
    throw error;
  }
}

/** Reserves the file for this job. A retry of the same object is allowed. A second object with the same bytes is not. */
async function claimContent(tableName: string, lockId: string, targetJobId: string): Promise<boolean> {
  const created = await putOnce(tableName, { jobId: lockId, targetJobId, kind: "content" });
  if (created) {
    return true;
  }
  const existing = await documentClient().send(
    new GetCommand({ TableName: tableName, Key: { jobId: lockId }, ConsistentRead: true }),
  );
  return existing.Item?.targetJobId === targetJobId;
}

/** Inserts the job only when that id is new. Returns false when the row already exists. */
async function putOnce(tableName: string, item: Record<string, unknown>): Promise<boolean> {
  try {
    await documentClient().send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(jobId)",
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return false;
    }
    throw error;
  }
}
