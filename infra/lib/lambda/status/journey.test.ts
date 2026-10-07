/** Checks that a workflow history becomes the stage list the job page draws. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TRANSCRIBE_MAX_BYTES } from "../../upload/content-id";
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
} from "./journey";

const JOB_ID = "a".repeat(32);

function job(overrides: Partial<JourneyJob> = {}): JourneyJob {
  return {
    jobId: JOB_ID,
    status: "running",
    failureReason: "",
    objectSize: 100,
    acceptDetected: false,
    acceptCount: 0,
    forceCount: 0,
    ...overrides,
  };
}

function entered(name: string, at = "2026-10-06T20:00:00.000Z"): HistoryMark {
  return { type: "TaskStateEntered", name, at };
}

describe("workflow journey", () => {
  it("names the first run, a language retry, and an accepted transcript", () => {
    assert.equal(executionName(job()), JOB_ID);
    assert.equal(executionName(job({ forceCount: 2 })), `${JOB_ID}-f2`);
    assert.equal(executionName(job({ forceCount: 2, acceptDetected: true, acceptCount: 1 })), `${JOB_ID}-a1`);
  });

  it("follows the execution stored on the row when a later run replaced the first name", () => {
    assert.equal(belongsToJob(JOB_ID, `${JOB_ID}-r2`), true);
    assert.equal(belongsToJob(JOB_ID, `${"b".repeat(32)}-r2`), false);
    assert.equal(executionName(job({ executionName: `${JOB_ID}-r2`, forceCount: 1 })), `${JOB_ID}-r2`);
  });

  it("treats a succeeded execution as closed and a wait as open", () => {
    const open = marksFromHistory([{ type: "ExecutionStarted" }, { type: "TaskStateEntered", stateEnteredEventDetails: { name: "WaitForTranscriptReadyDev" } }]);
    const closed = marksFromHistory([{ type: "ExecutionStarted" }, { type: "ExecutionSucceeded" }]);
    assert.equal(executionOpen(open), true);
    assert.equal(executionOpen(closed), false);
    assert.equal(waitingForTranscript(buildJourney(job(), open)), true);
  });

  it("builds an execution ARN from the state machine ARN", () => {
    assert.equal(
      executionArn("arn:aws:states:eu-central-1:123:stateMachine:workflow-dev", JOB_ID),
      `arn:aws:states:eu-central-1:123:execution:workflow-dev:${JOB_ID}`,
    );
  });

  it("shows the wait as the live step and skips audio extract for a small file", () => {
    const steps = buildJourney(job(), [
      { type: "ExecutionStarted", at: "2026-10-06T20:00:00.000Z" },
      entered("MarkRunningDev"),
      entered("PrepareMediaDev"),
      entered("StartHighlightsDev"),
      entered("WaitForTranscriptReadyDev", "2026-10-06T20:01:00.000Z"),
    ]);
    const byId = Object.fromEntries(steps.map((step) => [step.id, step.state]));
    assert.equal(byId.received, "done");
    assert.equal(byId.checking, "done");
    assert.equal(byId.extracting, "skipped");
    assert.equal(byId.transcribing, "done");
    assert.equal(byId.waiting, "current");
    assert.equal(byId.subtitles, "upcoming");
    assert.equal(steps.find((step) => step.id === "waiting")?.detail, "Transcription is running. This often takes a few minutes.");
  });

  it("includes audio extract when the file is over 2 GB", () => {
    const steps = buildJourney(job({ objectSize: TRANSCRIBE_MAX_BYTES + 1 }), [entered("MarkRunningDev")]);
    assert.equal(steps.find((step) => step.id === "extracting")?.state, "upcoming");
  });

  it("skips transcription when the stored transcript was accepted", () => {
    const steps = buildJourney(job({ acceptDetected: true, acceptCount: 1, objectSize: TRANSCRIBE_MAX_BYTES + 1 }), [
      entered("MarkRunningDev"),
      entered("BuildSubtitlesDev"),
    ]);
    const byId = Object.fromEntries(steps.map((step) => [step.id, step.state]));
    assert.equal(byId.extracting, "skipped");
    assert.equal(byId.transcribing, "skipped");
    assert.equal(byId.waiting, "skipped");
    assert.equal(byId.subtitles, "current");
  });

  it("stops on the wait when transcription times out and keeps the reason", () => {
    const steps = buildJourney(job({ status: "failed", failureReason: "Transcription did not finish before the wait ended." }), [
      entered("WaitForTranscriptReadyDev"),
      { type: "PassStateEntered", name: "NormalizeTimeoutDev" },
      {
        type: "PassStateExited",
        name: "NormalizeTimeoutDev",
        cause: undefined,
      },
    ]);
    const waiting = steps.find((step) => step.id === "waiting");
    assert.equal(waiting?.state, "failed");
    assert.equal(waiting?.detail, "Transcription did not finish before the wait ended.");
    assert.equal(steps.find((step) => step.id === "subtitles")?.state, "skipped");
    assert.equal(steps.find((step) => step.id === "finished")?.state, "done");
    assert.equal(JSON.stringify(steps).includes("taskToken"), false);
  });

  it("uses the subtitle error and drops a payload that carries the task token", () => {
    const marks = marksFromHistory([
      {
        type: "LambdaFunctionFailed",
        lambdaFunctionFailedEventDetails: { cause: JSON.stringify({ errorMessage: "The transcript file was empty." }) },
      },
      {
        type: "PassStateExited",
        stateExitedEventDetails: {
          name: "NormalizeBuildFailureDev",
          output: JSON.stringify({ taskToken: "secret-token", result: { reason: "The transcript file was empty." } }),
        },
      },
    ]);
    const steps = buildJourney(job({ status: "failed" }), [entered("BuildSubtitlesDev"), ...marks]);
    const subtitles = steps.find((step) => step.id === "subtitles");
    assert.equal(subtitles?.state, "failed");
    assert.equal(subtitles?.detail, "The transcript file was empty.");
    assert.equal(JSON.stringify(steps).includes("secret-token"), false);
    assert.equal(JSON.stringify(steps).includes("taskToken"), false);
  });

  it("explains a file that failed before the workflow started", () => {
    const steps = buildJourney(job({ status: "failed", failureReason: "Unknown profile \"feature-x\"" }), []);
    assert.equal(steps[0]?.state, "failed");
    assert.equal(steps[0]?.detail, "Unknown profile \"feature-x\"");
    assert.ok(steps.slice(1).every((step) => step.state === "skipped"));
  });
});
