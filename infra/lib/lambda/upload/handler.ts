/**
 * Presigns a short-lived upload into the video upload bucket, or returns the existing job when that file was already uploaded.
 * The profile comes from the word after the last underscore in the file name.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { readConfig } from "../../shared/runtime-config";
import { MAX_SINGLE_PUT_BYTES, contentKey, sha256HexToBase64 } from "../../upload/content-id";
import { cleanedFileName, profileFromFileName } from "../../upload/file-name";
import { documentClient } from "../dynamodb";
import { json, methodOf, readBody, type HttpEvent } from "../request-response";
import { required } from "../required-variable";

const s3 = new S3Client({
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const EXPIRES_SECONDS = 900;

/** Accepts a POST with the file name, the SHA-256, and the size. Returns a PUT URL, the existing job, or a 400. */
export async function handler(event: HttpEvent) {
  try {
    if (methodOf(event) !== "POST") {
      return json(405, { message: "Use POST." });
    }
    const body = readBody(event) as { profile?: unknown; fileName?: unknown; sha256?: unknown; size?: unknown };
    const config = readConfig();
    const fileName = cleanedFileName(body.fileName);
    const profile = profileFromFileName(body.fileName);
    if (!fileName || !profile) {
      return json(400, {
        message: "Use an MP4 named like sample_02_interview.mp4. The word after the last underscore is the profile.",
      });
    }
    if (!config.profiles[profile]) {
      const known = Object.keys(config.profiles).join(", ");
      return json(400, { message: `Unknown profile "${profile}". Expected one of: ${known}.` });
    }
    if (typeof body.profile === "string" && body.profile !== profile) {
      return json(400, { message: "The profile does not match the file name." });
    }

    const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      return json(400, { message: "Send the SHA-256 of the whole file." });
    }
    if (typeof body.size !== "number" || !Number.isInteger(body.size) || body.size < 1) {
      return json(400, { message: "Send the file size in bytes." });
    }
    if (body.size > MAX_SINGLE_PUT_BYTES) {
      return json(400, { message: "This file is larger than 5 GB. One upload can be at most 5 GB." });
    }

    const lockId = contentKey({ sha256, size: body.size, profile, outputs: config.languages.outputs });
    const existing = await documentClient().send(
      new GetCommand({ TableName: required("TABLE_NAME"), Key: { jobId: lockId }, ConsistentRead: true }),
    );
    if (existing.Item) {
      const existingJobId = existing.Item.targetJobId;
      if (typeof existingJobId === "string" && /^[a-f0-9]{32}$/.test(existingJobId)) {
        return json(200, { duplicate: true, jobId: existingJobId });
      }
      return json(409, { message: "This file is already being checked." });
    }

    const key = `video-upload/${profile}/${randomUUID()}.mp4`;
    const checksum = sha256HexToBase64(sha256);
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: required("VIDEO_UPLOAD_BUCKET"),
        Key: key,
        ContentType: "video/mp4",
        Metadata: { filename: fileName },
        ChecksumSHA256: checksum,
      }),
      { expiresIn: EXPIRES_SECONDS, unhoistableHeaders: new Set(["x-amz-checksum-sha256", "x-amz-meta-filename"]) },
    );
    return json(200, {
      uploadUrl,
      key,
      expiresIn: EXPIRES_SECONDS,
      headers: {
        "content-type": "video/mp4",
        "x-amz-meta-filename": fileName,
        "x-amz-checksum-sha256": checksum,
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "presign failed");
    return json(500, { message: "The upload URL could not be created." });
  }
}
