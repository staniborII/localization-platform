/**
 * Stores the Step Functions task token on the job while the workflow waits for Transcribe.
 * The token stays off the Transcribe job because the tag length is too small.
 */

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { documentClient } from "../dynamodb";
import { required } from "../required-variable";

interface TokenEvent {
  jobId?: string;
  taskToken?: string;
}

/** Writes the task token only while the job is running. */
export async function handler(event: TokenEvent): Promise<{ jobId: string }> {
  if (!event.jobId || !event.taskToken) {
    throw new Error("jobId and taskToken are required");
  }
  await documentClient().send(
    new UpdateCommand({
      TableName: required("TABLE_NAME"),
      Key: { jobId: event.jobId },
      ConditionExpression: "#status = :running",
      UpdateExpression: "SET taskToken = :token, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":running": "running",
        ":token": event.taskToken,
        ":now": new Date().toISOString(),
      },
    }),
  );
  return { jobId: event.jobId };
}
