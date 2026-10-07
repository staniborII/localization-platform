/**
 * Continues the workflow when Transcribe reports that a job finished or failed.
 * A closed task token is treated as success so a repeated event does not fail the run.
 */

import { SendTaskSuccessCommand, SFNClient } from "@aws-sdk/client-sfn";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { jobIdFromTranscriptionName } from "../../stable-job-id/job-id";
import { documentClient } from "../dynamodb";
import { required } from "../required-variable";

const steps = new SFNClient({});

interface TranscribeEvent {
  detail?: {
    TranscriptionJobName?: string;
    TranscriptionJobStatus?: string;
    FailureReason?: string;
  };
}

/** Sends the stored task token the transcript outcome. Ignores an event for an older transcription name. */
export async function handler(event: TranscribeEvent): Promise<void> {
  const transcriptionJobName = event.detail?.TranscriptionJobName;
  const status = event.detail?.TranscriptionJobStatus;
  const jobId = transcriptionJobName ? jobIdFromTranscriptionName(transcriptionJobName) : undefined;
  if (!jobId || (status !== "COMPLETED" && status !== "FAILED")) {
    return;
  }

  const item = await documentClient().send(
    new GetCommand({
      TableName: required("TABLE_NAME"),
      Key: { jobId },
      ConsistentRead: true,
    }),
  );
  const token = item.Item?.taskToken;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`Task token for ${jobId} is not stored yet`);
  }
  if (item.Item?.transcriptionJobName && item.Item.transcriptionJobName !== transcriptionJobName) {
    return;
  }

  const output = JSON.stringify({
    status,
    failureReason: status === "FAILED" ? (event.detail?.FailureReason ?? "Transcription failed") : "",
  });

  try {
    await steps.send(new SendTaskSuccessCommand({ taskToken: token, output }));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name.includes("TaskTimedOut") || name.includes("InvalidToken") || name.includes("TaskDoesNotExist")) {
      return;
    }
    throw error;
  }
}
