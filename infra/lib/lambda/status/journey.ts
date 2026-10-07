/**
 * Turns one workflow run into the stages the web client draws.
 * A stage is one stretch of the path, such as waiting for the transcript. The raw execution stays here.
 */

import { TRANSCRIBE_MAX_BYTES } from "../../upload/content-id";

export type StageState = "upcoming" | "current" | "done" | "skipped" | "failed";

export interface JourneyStep {
  id: string;
  title: string;
  detail: string;
  state: StageState;
  at?: string;
}

export interface JourneyJob {
  jobId: string;
  status: string;
  failureReason: string;
  objectSize: number;
  acceptDetected: boolean;
  acceptCount: number;
  forceCount: number;
  executionName?: string;
}

/** One history event, already reduced to the fields the stage list is allowed to see. */
export interface HistoryMark {
  type: string;
  name?: string;
  at?: string;
  cause?: string;
}

/** The bits of a history event this mapper reads. Input and output payloads are not kept. */
export interface RawHistoryEvent {
  type?: string;
  timestamp?: Date;
  stateEnteredEventDetails?: { name?: string };
  stateExitedEventDetails?: { name?: string; output?: string };
  taskFailedEventDetails?: { cause?: string };
  lambdaFunctionFailedEventDetails?: { cause?: string };
  executionFailedEventDetails?: { cause?: string };
}

interface StageCopy {
  id: string;
  title: string;
  upcoming: string;
  current: string;
  done: string;
  flag?: "extract" | "speech";
}

const STAGES: StageCopy[] = [
  {
    id: "received",
    title: "Upload received",
    upcoming: "The upload has not been stored as a job yet.",
    current: "The file is in the upload bucket. The workflow is about to start.",
    done: "The file is stored and the job exists.",
  },
  {
    id: "checking",
    title: "Checking the file",
    upcoming: "The workflow will decide how to read this video.",
    current: "The workflow is deciding whether the video can go straight to transcription.",
    done: "The workflow has chosen how to read this video.",
  },
  {
    id: "extracting",
    title: "Extracting audio",
    flag: "extract",
    upcoming: "The sound will be pulled out of this large file so transcription can read it.",
    current: "The file is over 2 GB. Only the sound is being pulled out.",
    done: "The sound was pulled out. The uploaded video stays as it was.",
  },
  {
    id: "transcribing",
    title: "Transcribing",
    flag: "speech",
    upcoming: "Transcription will be asked to listen for speech.",
    current: "Transcription is being started.",
    done: "Transcription was started.",
  },
  {
    id: "waiting",
    title: "Waiting for the transcript",
    flag: "speech",
    upcoming: "The workflow will wait until the transcript is ready.",
    current: "Transcription is running. This often takes a few minutes.",
    done: "The transcript is ready.",
  },
  {
    id: "subtitles",
    title: "Writing subtitles",
    upcoming: "Cues will be grouped, translated, and saved as subtitle files.",
    current: "English, German, and Spanish subtitle files are being written.",
    done: "The subtitle step finished.",
  },
  {
    id: "saving",
    title: "Saving the result",
    upcoming: "The job will be updated when the run ends.",
    current: "The result is being saved, and other systems are being told.",
    done: "The result is saved.",
  },
  {
    id: "finished",
    title: "Finished",
    upcoming: "The run ends here.",
    current: "The run is ending.",
    done: "The run has ended.",
  },
];

const STAGE_OF: Record<string, string> = {
  MarkRunning: "checking",
  PrepareMedia: "checking",
  Route: "checking",
  DetectedMode: "checking",
  ForcedMode: "checking",
  UnknownMode: "checking",
  ExtractAudio: "extracting",
  UseExtractedAudio: "extracting",
  NormalizeExtractFailure: "extracting",
  StartHighlights: "transcribing",
  StartSpeakers: "transcribing",
  StartMulti: "transcribing",
  StartForcedPlain: "transcribing",
  StartForcedSpeakers: "transcribing",
  GetAfterStartError: "transcribing",
  StartErrorStatus: "transcribing",
  NormalizeStartFailure: "transcribing",
  WaitForTranscriptReady: "waiting",
  AfterTranscript: "waiting",
  GetAfterTimeout: "waiting",
  TimeoutStatus: "waiting",
  NormalizeTimeout: "waiting",
  NormalizeWaitFailure: "waiting",
  NormalizeTranscriptFailure: "waiting",
  BuildSubtitles: "subtitles",
  NormalizeCue: "subtitles",
  NormalizeBuildFailure: "subtitles",
  Outcome: "saving",
  SaveCompleted: "saving",
  SaveEmpty: "saving",
  SaveNeedsReview: "saving",
  SaveFailed: "saving",
  PublishCompleted: "saving",
  PublishEmpty: "saving",
  PublishNeedsReview: "saving",
  PublishFailed: "saving",
  Done: "finished",
};

const FAILURE_STATES = new Set([
  "NormalizeExtractFailure",
  "NormalizeStartFailure",
  "NormalizeTimeout",
  "NormalizeWaitFailure",
  "NormalizeTranscriptFailure",
  "NormalizeBuildFailure",
  "UnknownMode",
]);

const FAILURE_COPY: Record<string, string> = {
  NormalizeExtractFailure: "The audio extract did not finish.",
  NormalizeStartFailure: "Transcription could not be started.",
  NormalizeTimeout: "Transcription did not finish before the wait ended.",
  NormalizeWaitFailure: "The workflow could not wait for the transcript.",
  NormalizeTranscriptFailure: "The transcript did not succeed.",
  NormalizeBuildFailure: "The subtitle step did not finish.",
  UnknownMode: "The profile mode is not supported.",
};

const KNOWN_STATES = Object.keys(STAGE_OF).sort((left, right) => right.length - left.length);
const ENTERED_TYPES = new Set([
  "TaskStateEntered",
  "ChoiceStateEntered",
  "PassStateEntered",
  "SucceedStateEntered",
  "FailStateEntered",
  "WaitStateEntered",
]);
const EXITED_TYPES = new Set(["TaskStateExited", "ChoiceStateExited", "PassStateExited", "SucceedStateExited", "WaitStateExited"]);
const TERMINAL = new Set(["completed", "failed", "needs_review", "empty"]);
const CLOSED_EXECUTION = new Set(["ExecutionSucceeded", "ExecutionFailed", "ExecutionAborted", "ExecutionTimedOut"]);

/** True when an execution name belongs to this job. A suffix is a later run, such as a language retry. */
export function belongsToJob(jobId: string, name: string): boolean {
  if (!/^[a-f0-9]{32}$/.test(jobId)) {
    return false;
  }
  if (name === jobId) {
    return true;
  }
  return name.startsWith(`${jobId}-`) && /^[a-f0-9]{32}-[A-Za-z0-9-]{1,40}$/.test(name);
}

/** The execution name for this job. The name stored on the row wins, because a later run replaces it. */
export function executionName(job: Pick<JourneyJob, "jobId" | "acceptDetected" | "acceptCount" | "forceCount" | "executionName">): string {
  if (job.executionName && belongsToJob(job.jobId, job.executionName)) {
    return job.executionName;
  }
  if (job.acceptDetected && job.acceptCount > 0) {
    return `${job.jobId}-a${job.acceptCount}`;
  }
  if (job.forceCount > 0) {
    return `${job.jobId}-f${job.forceCount}`;
  }
  return job.jobId;
}

/** True when this history has started and has not succeeded, failed, or been stopped. */
export function executionOpen(marks: HistoryMark[]): boolean {
  const started = marks.some((mark) => mark.type === "ExecutionStarted");
  const closed = marks.some((mark) => CLOSED_EXECUTION.has(mark.type));
  return started && !closed;
}

/** True when the path is sitting in the transcript wait. That is the only step Continue may wake. */
export function waitingForTranscript(steps: JourneyStep[]): boolean {
  return steps.some((step) => step.id === "waiting" && step.state === "current");
}

/** Builds the execution ARN from the state machine ARN and the execution name. */
export function executionArn(stateMachineArn: string, name: string): string {
  const marker = ":stateMachine:";
  const index = stateMachineArn.indexOf(marker);
  if (index < 0) {
    throw new Error("The state machine ARN is not valid.");
  }
  return `${stateMachineArn.slice(0, index)}:execution:${stateMachineArn.slice(index + marker.length)}:${name}`;
}

/** Keeps the state name, the time, and a short reason. Drops everything else in the event. */
export function marksFromHistory(events: RawHistoryEvent[]): HistoryMark[] {
  const marks: HistoryMark[] = [];
  for (const event of events) {
    const type = event.type ?? "";
    const at = event.timestamp instanceof Date ? event.timestamp.toISOString() : undefined;
    if (type === "ExecutionStarted" || CLOSED_EXECUTION.has(type)) {
      const cause = type === "ExecutionFailed" ? readableCause(event.executionFailedEventDetails?.cause) : undefined;
      marks.push({ type, at, ...(cause ? { cause } : {}) });
      continue;
    }
    if (ENTERED_TYPES.has(type)) {
      marks.push({ type, name: event.stateEnteredEventDetails?.name, at });
      continue;
    }
    if (EXITED_TYPES.has(type)) {
      marks.push({ type, name: event.stateExitedEventDetails?.name, at, cause: reasonFromOutput(event.stateExitedEventDetails?.output) });
      continue;
    }
    const cause = readableCause(
      event.lambdaFunctionFailedEventDetails?.cause ?? event.taskFailedEventDetails?.cause ?? event.executionFailedEventDetails?.cause,
    );
    if (cause) {
      marks.push({ type, at, cause });
    }
  }
  return marks;
}

/** Builds the stage list for one job. Missing history still returns the path, with the live step called out. */
export function buildJourney(job: JourneyJob, marks: HistoryMark[], options?: { historyMissing?: boolean }): JourneyStep[] {
  const flags = pathFlags(job, marks);
  if (marks.length === 0) {
    return emptyJourney(job, flags, options?.historyMissing === true);
  }

  const reached = new Set<string>();
  const enteredAt = new Map<string, string>();
  let failedStage = "";
  let failureDetail = "";
  let pendingCause = "";

  if (marks.some((mark) => mark.type === "ExecutionStarted")) {
    reached.add("received");
  }

  for (const mark of marks) {
    if (!mark.name && mark.cause) {
      pendingCause = mark.cause;
      continue;
    }
    const base = baseName(mark.name);
    const stage = base ? STAGE_OF[base] : undefined;
    if (!base || !stage) {
      continue;
    }
    reached.add("received");
    reached.add(stage);
    if (mark.at && !enteredAt.has(stage)) {
      enteredAt.set(stage, mark.at);
    }
    if (FAILURE_STATES.has(base)) {
      failedStage = stage;
      failureDetail = mark.cause || pendingCause || FAILURE_COPY[base] || "This step did not finish.";
    } else if (mark.cause && stage === failedStage) {
      failureDetail = mark.cause;
    }
    pendingCause = "";
  }

  if (TERMINAL.has(job.status)) {
    reached.add("finished");
  }

  return paint(job, flags, reached, enteredAt, failedStage, failureDetail);
}

/** Picks the execution that is actually in progress when a job has been retried. */
function pathFlags(job: JourneyJob, marks: HistoryMark[]): { extract: boolean; speech: boolean } {
  const names = marks.map((mark) => baseName(mark.name)).filter((name): name is string => Boolean(name));
  const sawExtract = names.some((name) => name === "ExtractAudio" || name === "UseExtractedAudio" || name === "NormalizeExtractFailure");
  const sawSpeech = names.some((name) => name.startsWith("Start") || name === "WaitForTranscriptReady" || name === "NormalizeTimeout");
  if (job.acceptDetected && !sawSpeech) {
    return { extract: false, speech: false };
  }
  return {
    extract: sawExtract || job.objectSize > TRANSCRIBE_MAX_BYTES,
    speech: true,
  };
}

/** A job whose execution has not reported steps yet, or never started. */
function emptyJourney(job: JourneyJob, flags: { extract: boolean; speech: boolean }, historyMissing: boolean): JourneyStep[] {
  if (job.status === "failed") {
    return STAGES.map((stage) =>
      stage.id === "received"
        ? step(stage, "failed", job.failureReason || "The file could not start.")
        : step(stage, "skipped", "The workflow did not start."),
    );
  }

  const current = job.status === "running" ? "checking" : "received";
  return STAGES.map((stage) => {
    if (stage.flag === "extract" && !flags.extract) {
      return step(stage, "skipped", "Not needed. This file is small enough to transcribe directly.");
    }
    if (stage.flag === "speech" && !flags.speech) {
      return step(stage, "skipped", "Not needed. Subtitles will be written from the transcript already stored.");
    }
    if (TERMINAL.has(job.status) && stage.id === "received") {
      return step(stage, "done");
    }
    if (TERMINAL.has(job.status) && stage.id === "finished") {
      return step(stage, "done", finishedDetail(job));
    }
    if (TERMINAL.has(job.status)) {
      return step(stage, "skipped", "The step list for this run is no longer available.");
    }
    if (stage.id === "received" && current === "checking") {
      return step(stage, "done");
    }
    if (stage.id === current) {
      const detail = historyMissing ? "The live steps could not be read. This page will try again shortly." : stage.current;
      return step(stage, "current", detail);
    }
    return step(stage, "upcoming");
  });
}

/** Fills titles and sentences once the walk knows which stages were entered. */
function paint(
  job: JourneyJob,
  flags: { extract: boolean; speech: boolean },
  reached: Set<string>,
  enteredAt: Map<string, string>,
  failedStage: string,
  failureDetail: string,
): JourneyStep[] {
  const terminal = TERMINAL.has(job.status);
  let lastReached = -1;
  STAGES.forEach((stage, index) => {
    if (reached.has(stage.id)) {
      lastReached = index;
    }
  });
  const failedIndex = STAGES.findIndex((stage) => stage.id === failedStage);

  return STAGES.map((stage, index) => {
    if (stage.flag === "extract" && !flags.extract && stage.id !== failedStage) {
      return step(stage, "skipped", "Not needed. This file is small enough to transcribe directly.");
    }
    if (stage.flag === "speech" && !flags.speech && stage.id !== failedStage) {
      return step(stage, "skipped", "Not needed. Subtitles are written from the transcript already stored.");
    }
    if (stage.id === failedStage) {
      const saved = readableCause(job.failureReason);
      return step(stage, "failed", saved || failureDetail || "This step did not finish.", enteredAt.get(stage.id));
    }
    if (!reached.has(stage.id)) {
      if (failedIndex >= 0 && index > failedIndex && stage.id !== "saving" && stage.id !== "finished") {
        return step(stage, "skipped", "The run stopped before this step.");
      }
      return step(stage, "upcoming");
    }
    const at = enteredAt.get(stage.id);
    if (!terminal && failedIndex < 0 && index === lastReached) {
      return step(stage, "current", undefined, at);
    }
    if (stage.id === "finished") {
      return step(stage, "done", finishedDetail(job), at);
    }
    if (stage.id === "subtitles") {
      return step(stage, "done", subtitleDetail(job), at);
    }
    return step(stage, "done", undefined, at);
  });
}

/** One stage ready for the page, with the sentence that matches its state. */
function step(stage: StageCopy, state: StageState, detail?: string, at?: string): JourneyStep {
  const sentence =
    detail ??
    (state === "current" ? stage.current : state === "done" ? stage.done : state === "upcoming" ? stage.upcoming : stage.done);
  return {
    id: stage.id,
    title: stage.title,
    detail: sentence,
    state,
    ...(at ? { at } : {}),
  };
}

/** The closing sentence for a run that has a final status. */
function finishedDetail(job: JourneyJob): string {
  if (job.status === "completed") {
    return "English, German, and Spanish subtitle files are ready.";
  }
  if (job.status === "empty") {
    return "No speech was detected, so there are no subtitle files.";
  }
  if (job.status === "needs_review") {
    return "The spoken language needs a choice before translation.";
  }
  if (job.status === "failed") {
    return "The run stopped.";
  }
  return "The run has ended.";
}

/** What the subtitle stage should say once it has been left. */
function subtitleDetail(job: JourneyJob): string {
  if (job.status === "needs_review") {
    return "The transcript was kept. Translation is waiting for a language choice.";
  }
  if (job.status === "empty") {
    return "No speech was found, so no subtitle files were written.";
  }
  if (job.status === "completed") {
    return "English, German, and Spanish subtitle files were written.";
  }
  return "The subtitle step finished.";
}

/** Drops the stage suffix, so WaitForTranscriptReadyDev matches WaitForTranscriptReady. */
function baseName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  return KNOWN_STATES.find((state) => name === state || (name.startsWith(state) && /^[A-Z][a-zA-Z]*$/.test(name.slice(state.length))));
}

/** Pulls result.reason out of a state output and ignores the rest of the payload. */
function reasonFromOutput(output: string | undefined): string | undefined {
  if (!output) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(output) as { result?: { reason?: unknown }; reason?: unknown };
    const reason = parsed.result?.reason ?? parsed.reason;
    return typeof reason === "string" ? readableCause(reason) : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps a short failure sentence and drops tokens, addresses, and raw payloads. */
function readableCause(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  let text = raw.trim();
  try {
    const parsed = JSON.parse(text) as { errorMessage?: unknown; Cause?: unknown; cause?: unknown };
    if (typeof parsed.errorMessage === "string") {
      text = parsed.errorMessage;
    } else if (typeof parsed.Cause === "string") {
      text = parsed.Cause;
    } else if (typeof parsed.cause === "string") {
      text = parsed.cause;
    } else {
      return undefined;
    }
  } catch {
    // A plain sentence from the workflow is already the text we want.
  }
  text = text.replace(/\s+/g, " ").trim();
  if (/taskToken|mediaUri|audioUri|secret|password/i.test(text)) {
    return undefined;
  }
  text = text
    .replace(/arn:aws:[^\s"]+/g, "")
    .replace(/s3:\/\/\S+/g, "")
    .trim();
  if (!text.includes(" ") && text.length > 80) {
    return undefined;
  }
  if (text.length < 8) {
    return undefined;
  }
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}
