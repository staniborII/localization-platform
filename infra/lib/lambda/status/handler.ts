/**
 * Serves the web client job list, one job, a forced-language rerun, accepting a mixed transcript, and continuing a finished transcript.
 * A single job includes the stages of the execution named on the row. Completed jobs include short-lived links for the video and the subtitle files.
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ExecutionAlreadyExists,
  ExecutionDoesNotExist,
  GetExecutionHistoryCommand,
  ListExecutionsCommand,
  SendTaskSuccessCommand,
  SFNClient,
  StartExecutionCommand,
} from "@aws-sdk/client-sfn";
import { GetTranscriptionJobCommand, TranscribeClient } from "@aws-sdk/client-transcribe";
import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { readConfig } from "../../shared/runtime-config";
import { executionInput, type ProfileSettings } from "../../transcription/build-transcription-input";
import { audioObjectUris } from "../../upload/content-id";
import { documentClient } from "../dynamodb";
import { required } from "../required-variable";
import { json, methodOf, readBody, type HttpEvent } from "../request-response";
import {
  belongsToJob,
  buildJourney,
  executionArn,
  executionName,
  executionOpen,
  marksFromHistory,
  waitingForTranscript,
  type HistoryMark,
  type JourneyJob,
  type JourneyStep,
} from "./journey";

const s3 = new S3Client({});
const steps = new SFNClient({});
const transcribe = new TranscribeClient({});
const EXPIRES_SECONDS = 900;
const STATUSES = new Set(["received", "running", "completed", "failed", "needs_review", "empty"]);

interface OutputRow {
  lang?: string;
  vttKey?: string;
  srtKey?: string;
}

/** GET lists or reads a job. POST reruns a language choice, or continues a wait whose transcript is already done. */
export async function handler(event: HttpEvent) {
  try {
    const method = methodOf(event);
    if (method === "GET") {
      return await getJobs(event);
    }
    if (method === "POST") {
      return await rerun(event);
    }
    return json(405, { message: "Use GET or POST." });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "status failed");
    return json(500, { message: "The job request failed." });
  }
}

/** Returns one job when id is set, or the recent list, optionally filtered by status. */
async function getJobs(event: HttpEvent) {
  const id = event.queryStringParameters?.id;
  const status = event.queryStringParameters?.status;
  if (id) {
    if (!/^[a-f0-9]{32}$/.test(id)) {
      return json(400, { message: "Unknown job." });
    }
    const item = await documentClient().send(
      new GetCommand({ TableName: required("TABLE_NAME"), Key: { jobId: id }, ConsistentRead: true }),
    );
    if (!item.Item) {
      return json(404, { message: "Unknown job." });
    }
    const journey = await loadJourney(item.Item);
    return json(200, { job: await present(item.Item, true, journey.steps, journey.canContinue) });
  }

  if (status && !STATUSES.has(status)) {
    return json(400, { message: "Unknown status." });
  }
  const result = status
    ? await documentClient().send(
        new QueryCommand({
          TableName: required("TABLE_NAME"),
          IndexName: "status",
          KeyConditionExpression: "#status = :status",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":status": status },
          ScanIndexForward: false,
          Limit: 50,
        }),
      )
    : await documentClient().send(
        new QueryCommand({
          TableName: required("TABLE_NAME"),
          IndexName: "recent",
          KeyConditionExpression: "listPk = :job",
          ExpressionAttributeValues: { ":job": "job" },
          ScanIndexForward: false,
          Limit: 50,
        }),
      );
  const withUrls = status === "completed";
  const jobs = await Promise.all((result.Items ?? []).map((item) => present(item, withUrls)));
  return json(200, { jobs });
}

/** Starts a language rerun, accepts a mixed transcript, or wakes a wait whose transcript is already done. */
async function rerun(event: HttpEvent) {
  const body = readBody(event) as { jobId?: unknown; sourceLanguage?: unknown; acceptDetected?: unknown; continueWait?: unknown };
  if (body.continueWait === true) {
    return continueWait(typeof body.jobId === "string" ? body.jobId : "");
  }
  if (body.acceptDetected === true) {
    return acceptDetected(typeof body.jobId === "string" ? body.jobId : "");
  }
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const sourceLanguage = typeof body.sourceLanguage === "string" ? body.sourceLanguage : "";
  const config = readConfig();
  if (!/^[a-f0-9]{32}$/.test(jobId) || !config.languages.candidates.includes(sourceLanguage)) {
    return json(400, { message: "Choose a detected language and a job that needs review." });
  }

  const current = await documentClient().send(
    new GetCommand({ TableName: required("TABLE_NAME"), Key: { jobId }, ConsistentRead: true }),
  );
  const item = current.Item;
  if (!item) {
    return json(404, { message: "Unknown job." });
  }
  const profileName = String(item.profile ?? "");
  const profile = config.profiles[profileName] as ProfileSettings | undefined;
  if (!profile || typeof item.bucket !== "string" || typeof item.objectKey !== "string") {
    return json(400, { message: "This job cannot be rerun." });
  }

  const forceCount = typeof item.forceCount === "number" ? item.forceCount : 0;
  const nextCount = forceCount + 1;
  const transcriptionJobName = `${jobId}-f${nextCount}`;
  const audio = audioObjectUris(required("TRANSCRIPT_SUBTITLE_BUCKET"), jobId);
  const input = executionInput({
    jobId,
    profile: profileName,
    profileSettings: profile,
    bucket: item.bucket,
    key: item.objectKey,
    targetLanguages: Array.isArray(item.targetLanguages) ? (item.targetLanguages as string[]) : config.languages.outputs,
    transcriptionJobName,
    forceLanguage: sourceLanguage,
    objectSize: typeof item.objectSize === "number" ? item.objectSize : 0,
    audioDestination: audio.destination,
    audioUri: audio.uri,
  });

  try {
    await documentClient().send(
      new UpdateCommand({
        TableName: required("TABLE_NAME"),
        Key: { jobId },
        ConditionExpression: "#status = :review AND (attribute_not_exists(forceCount) OR forceCount = :current)",
        UpdateExpression:
          "SET #status = :running, forcedLanguage = :language, forceCount = :next, transcriptionJobName = :transcription, transcriptKey = :transcript, executionName = :execution, updatedAt = :now REMOVE failureReason, acceptDetected",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":review": "needs_review",
          ":running": "running",
          ":language": sourceLanguage,
          ":current": forceCount,
          ":next": nextCount,
          ":transcription": transcriptionJobName,
          ":transcript": input.transcriptKey,
          ":execution": `${jobId}-f${nextCount}`,
          ":now": new Date().toISOString(),
        },
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return json(409, { message: "This job is not waiting for a language choice." });
    }
    throw error;
  }

  try {
    await steps.send(
      new StartExecutionCommand({
        stateMachineArn: required("STATE_MACHINE_ARN"),
        name: `${jobId}-f${nextCount}`,
        input: JSON.stringify(input),
      }),
    );
  } catch (error) {
    if (error instanceof ExecutionAlreadyExists || (error instanceof Error && error.name === "ExecutionAlreadyExists")) {
      return json(200, { jobId, status: "running" });
    }
    throw error;
  }
  return json(200, { jobId, status: "running" });
}

/** Writes subtitles from the transcript already stored. A one-language review cannot take this path. */
async function acceptDetected(jobId: string) {
  if (!/^[a-f0-9]{32}$/.test(jobId)) {
    return json(400, { message: "Choose a job that needs review." });
  }
  const current = await documentClient().send(
    new GetCommand({ TableName: required("TABLE_NAME"), Key: { jobId }, ConsistentRead: true }),
  );
  const item = current.Item;
  if (!item) {
    return json(404, { message: "Unknown job." });
  }
  const detected = Array.isArray(item.detectedLanguages) ? item.detectedLanguages.filter((language) => typeof language === "string") : [];
  if (detected.length < 2) {
    return json(400, { message: "This transcript has one spoken language. Choose that language." });
  }
  const profileName = String(item.profile ?? "");
  const profile = readConfig().profiles[profileName] as ProfileSettings | undefined;
  if (!profile || typeof item.bucket !== "string" || typeof item.objectKey !== "string") {
    return json(400, { message: "This job cannot be rerun." });
  }
  const transcriptionJobName = typeof item.transcriptionJobName === "string" ? item.transcriptionJobName : jobId;
  const acceptCount = typeof item.acceptCount === "number" ? item.acceptCount : 0;
  const nextCount = acceptCount + 1;
  const audio = audioObjectUris(required("TRANSCRIPT_SUBTITLE_BUCKET"), jobId);
  const input = executionInput({
    jobId,
    profile: profileName,
    profileSettings: profile,
    bucket: item.bucket,
    key: item.objectKey,
    targetLanguages: Array.isArray(item.targetLanguages) ? (item.targetLanguages as string[]) : readConfig().languages.outputs,
    transcriptionJobName,
    objectSize: typeof item.objectSize === "number" ? item.objectSize : 0,
    audioDestination: audio.destination,
    audioUri: audio.uri,
    acceptDetected: true,
  });

  try {
    await documentClient().send(
      new UpdateCommand({
        TableName: required("TABLE_NAME"),
        Key: { jobId },
        ConditionExpression: "#status = :review AND (attribute_not_exists(acceptCount) OR acceptCount = :current)",
        UpdateExpression: "SET #status = :running, acceptDetected = :yes, acceptCount = :next, executionName = :execution, updatedAt = :now REMOVE failureReason",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":review": "needs_review",
          ":running": "running",
          ":yes": true,
          ":current": acceptCount,
          ":next": nextCount,
          ":execution": `${jobId}-a${nextCount}`,
          ":now": new Date().toISOString(),
        },
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return json(409, { message: "This job is not waiting for a language choice." });
    }
    throw error;
  }

  try {
    await steps.send(
      new StartExecutionCommand({
        stateMachineArn: required("STATE_MACHINE_ARN"),
        name: `${jobId}-a${nextCount}`,
        input: JSON.stringify(input),
      }),
    );
  } catch (error) {
    if (error instanceof ExecutionAlreadyExists || (error instanceof Error && error.name === "ExecutionAlreadyExists")) {
      return json(200, { jobId, status: "running" });
    }
    throw error;
  }
  return json(200, { jobId, status: "running" });
}

/** Reads the run named on the row. A job that is still running follows an open execution instead of an older finished one. */
async function loadJourney(item: Record<string, unknown>): Promise<{ steps: JourneyStep[]; canContinue: boolean }> {
  const journeyJob = toJourneyJob(item);
  const preferred = executionName(journeyJob);
  if (!belongsToJob(journeyJob.jobId, preferred)) {
    return { steps: buildJourney(journeyJob, []), canContinue: false };
  }
  let run = await readRun(preferred);
  if (journeyJob.status === "running" && !executionOpen(run.marks)) {
    const live = await findRunningExecution(journeyJob.jobId);
    if (live && live !== preferred) {
      await rememberExecution(journeyJob.jobId, live);
      run = await readRun(live);
    }
  }
  const steps = buildJourney(journeyJob, run.marks, { historyMissing: run.missing });
  return { steps, canContinue: await transcriptCanContinue(item, steps, run.marks) };
}

/** Wakes the waiting step when Transcribe has already finished. The task token stays on the server. */
async function continueWait(jobId: string) {
  if (!/^[a-f0-9]{32}$/.test(jobId)) {
    return json(400, { message: "Unknown job." });
  }
  const current = await documentClient().send(
    new GetCommand({ TableName: required("TABLE_NAME"), Key: { jobId }, ConsistentRead: true }),
  );
  const item = current.Item;
  const token = item?.taskToken;
  const transcriptionJobName = item?.transcriptionJobName;
  if (!item || item.status !== "running" || typeof token !== "string" || token.length === 0 || typeof transcriptionJobName !== "string") {
    return json(409, { message: "This job is not waiting on a transcript." });
  }
  const outcome = await transcriptionOutcome(transcriptionJobName);
  if (!outcome) {
    return json(409, { message: "Transcription has not finished." });
  }
  try {
    await steps.send(new SendTaskSuccessCommand({ taskToken: token, output: JSON.stringify(outcome) }));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name.includes("TaskTimedOut") || name.includes("InvalidToken") || name.includes("TaskDoesNotExist")) {
      return json(200, { jobId, status: "running" });
    }
    throw error;
  }
  return json(200, { jobId, status: "running" });
}

/** Continue is offered only while this run is open, sitting in the wait, and the transcript is already done or failed. */
async function transcriptCanContinue(item: Record<string, unknown>, steps: JourneyStep[], marks: HistoryMark[]): Promise<boolean> {
  const transcriptionJobName = item.transcriptionJobName;
  if (item.status !== "running" || typeof item.taskToken !== "string" || item.taskToken.length === 0) {
    return false;
  }
  if (!executionOpen(marks) || !waitingForTranscript(steps) || typeof transcriptionJobName !== "string") {
    return false;
  }
  return (await transcriptionOutcome(transcriptionJobName)) !== undefined;
}

/** Reads a finished or failed transcription. A job that is still running, or missing, cannot be continued. */
async function transcriptionOutcome(transcriptionJobName: string): Promise<{ status: string; failureReason: string } | undefined> {
  try {
    const described = await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: transcriptionJobName }));
    const status = described.TranscriptionJob?.TranscriptionJobStatus;
    if (status !== "COMPLETED" && status !== "FAILED") {
      return undefined;
    }
    return {
      status,
      failureReason: status === "FAILED" ? (described.TranscriptionJob?.FailureReason ?? "Transcription failed") : "",
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name.includes("BadRequest")) {
      return undefined;
    }
    console.error("transcription status was not readable", error instanceof Error ? error.message : "transcribe failed");
    return undefined;
  }
}

/** The newest open execution for this job, when the name on the row already finished. */
async function findRunningExecution(jobId: string): Promise<string | undefined> {
  try {
    let nextToken: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      const listed = await steps.send(
        new ListExecutionsCommand({
          stateMachineArn: required("STATE_MACHINE_ARN"),
          statusFilter: "RUNNING",
          maxResults: 100,
          nextToken,
        }),
      );
      const live = listed.executions?.find((execution) => execution.name && belongsToJob(jobId, execution.name));
      if (live?.name) {
        return live.name;
      }
      nextToken = listed.nextToken;
      if (!nextToken) {
        break;
      }
    }
  } catch (error) {
    console.error("running executions were not readable", error instanceof Error ? error.message : "list failed");
  }
  return undefined;
}

/** Remembers the open execution so a later read still shows it after that run ends. */
async function rememberExecution(jobId: string, name: string): Promise<void> {
  try {
    await documentClient().send(
      new UpdateCommand({
        TableName: required("TABLE_NAME"),
        Key: { jobId },
        ConditionExpression: "#status = :running",
        UpdateExpression: "SET executionName = :name",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":running": "running", ":name": name },
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return;
    }
    console.error("execution name was not stored", error instanceof Error ? error.message : "update failed");
  }
}

/** Reads one execution. A missing execution is an empty path. Any other read error keeps the path and says the live steps are unavailable. */
async function readRun(name: string): Promise<{ marks: HistoryMark[]; missing: boolean }> {
  try {
    const events = await readHistory(executionArn(required("STATE_MACHINE_ARN"), name));
    return { marks: marksFromHistory(events), missing: false };
  } catch (error) {
    if (error instanceof ExecutionDoesNotExist || (error instanceof Error && error.name === "ExecutionDoesNotExist")) {
      return { marks: [], missing: false };
    }
    console.error("execution history was not readable", error instanceof Error ? error.message : "history failed");
    return { marks: [], missing: true };
  }
}

/** Pages through one execution. Five pages is more history than one localization run produces. */
async function readHistory(arn: string) {
  const events = [];
  let nextToken: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const result = await steps.send(
      new GetExecutionHistoryCommand({
        executionArn: arn,
        maxResults: 1000,
        nextToken,
      }),
    );
    events.push(...(result.events ?? []));
    nextToken = result.nextToken;
    if (!nextToken) {
      break;
    }
  }
  return events;
}

/** Copies the row fields the stage list needs. The task token is not one of them. */
function toJourneyJob(item: Record<string, unknown>): JourneyJob {
  return {
    jobId: typeof item.jobId === "string" ? item.jobId : "",
    status: typeof item.status === "string" ? item.status : "",
    failureReason: typeof item.failureReason === "string" ? item.failureReason : "",
    objectSize: typeof item.objectSize === "number" ? item.objectSize : 0,
    acceptDetected: item.acceptDetected === true,
    acceptCount: typeof item.acceptCount === "number" ? item.acceptCount : 0,
    forceCount: typeof item.forceCount === "number" ? item.forceCount : 0,
    executionName: typeof item.executionName === "string" ? item.executionName : undefined,
  };
}

/** Shapes a table row for the web client. Presigned URLs are added only when requested. A running job does not keep an older failure sentence. */
async function present(item: Record<string, unknown>, withUrls: boolean, steps?: JourneyStep[], canContinue = false) {
  const outputs = Array.isArray(item.outputs) ? (item.outputs as OutputRow[]) : [];
  const signedOutputs = withUrls
    ? await Promise.all(
        outputs.map(async (output) => ({
          lang: output.lang,
          vttKey: output.vttKey,
          srtKey: output.srtKey,
          vttUrl: output.vttKey ? await signedGet(required("TRANSCRIPT_SUBTITLE_BUCKET"), output.vttKey) : undefined,
          srtUrl: output.srtKey ? await signedGet(required("TRANSCRIPT_SUBTITLE_BUCKET"), output.srtKey) : undefined,
        })),
      )
    : outputs;
  const videoUrl =
    withUrls && typeof item.objectKey === "string" ? await signedGet(required("VIDEO_UPLOAD_BUCKET"), item.objectKey) : undefined;
  return {
    jobId: item.jobId,
    status: item.status,
    profile: item.profile,
    fileName: item.fileName,
    sourceLanguage: item.sourceLanguage ?? "",
    languageConfidence: item.languageConfidence ?? null,
    speakerSaturation: item.speakerSaturation === true,
    failureReason: item.status === "running" || item.status === "received" ? "" : (item.failureReason ?? ""),
    forcedLanguage: item.forcedLanguage ?? "",
    detectedLanguages: Array.isArray(item.detectedLanguages)
      ? item.detectedLanguages.filter((language): language is string => typeof language === "string")
      : [],
    outputs: signedOutputs,
    videoUrl,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    ...(steps ? { steps, canContinue } : {}),
  };
}

/** Returns a 15-minute GET URL for one object. */
function signedGet(bucket: string, key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: EXPIRES_SECONDS });
}
