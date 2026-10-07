/**
 * Shared DynamoDB client for the jobs table.
 * A handler keeps one client for the life of the process.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let documents: DynamoDBDocumentClient | undefined;

/** Returns the jobs-table client. Empty fields are left out of writes. */
export function documentClient(): DynamoDBDocumentClient {
  documents ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return documents;
}
