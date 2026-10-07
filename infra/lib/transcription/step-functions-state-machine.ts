/**
 * The localization state machine: prepare the media, start Transcribe, wait for the transcript, then build subtitles.
 * A file over 2 GiB has its audio extracted first. Accepting a mixed transcript skips Transcribe and writes subtitles from the stored transcript.
 */

import { ArnFormat, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import type { IEventBus } from "aws-cdk-lib/aws-events";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import {
  Choice,
  Condition,
  DefinitionBody,
  Fail,
  IntegrationPattern,
  JsonPath,
  LogLevel,
  Pass,
  StateMachine,
  StateMachineType,
  Succeed,
  TaskInput,
  Timeout,
} from "aws-cdk-lib/aws-stepfunctions";
import {
  CallAwsService,
  DynamoAttributeValue,
  DynamoUpdateItem,
  EventBridgePutEvents,
  LambdaInvoke,
  MediaConvertCreateJob,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";
import { stagified } from "../utils";
import { TRANSCRIBE_MAX_BYTES } from "../upload/content-id";
import type { StageConfig } from "../utils/schema";

export interface LocalizationWorkflowProps {
  config: StageConfig;
  stage: string;
  stateMachineName: string;
  jobTable: ITable;
  transcriptSubtitleBucket: IBucket;
  eventBus: IEventBus;
  tokenFunction: IFunction;
  cueFunction: IFunction;
  removalPolicy: RemovalPolicy;
  audioExtractRoleArn: string;
}

export class LocalizationWorkflow extends Construct {
  readonly stateMachine: StateMachine;
  readonly workflowLogs: LogGroup;

  constructor(scope: Construct, id: string, props: LocalizationWorkflowProps) {
    super(scope, id);
    const { config, stage, stateMachineName, jobTable, transcriptSubtitleBucket, eventBus, tokenFunction, cueFunction, removalPolicy } = props;
    const jobArn = Stack.of(this).formatArn({
      service: "transcribe",
      resource: "transcription-job",
      resourceName: "*",
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
    const languages = config.languages.candidates;
    const stateId = (name: string) => stagified(name, stage);

    const done = new Succeed(this, stateId("Done"));
    const outcome = new Choice(this, stateId("Outcome"));

    const publish = (name: string, detailType: string) =>
      new EventBridgePutEvents(this, stateId(name), {
        entries: [
          {
            detailType,
            source: "bundesliga.localization",
            eventBus: eventBus,
            detail: eventDetail(),
          },
        ],
        resultPath: JsonPath.DISCARD,
      });

    const save = (name: string, status: string) =>
      new DynamoUpdateItem(this, stateId(name), {
        table: jobTable,
        key: { jobId: DynamoAttributeValue.fromString(JsonPath.stringAt("$.jobId")) },
        updateExpression: "SET #status = :status, updatedAt = :now, failureReason = :reason",
        conditionExpression: "#status = :running",
        expressionAttributeNames: { "#status": "status" },
        expressionAttributeValues: {
          ":status": DynamoAttributeValue.fromString(status),
          ":running": DynamoAttributeValue.fromString("running"),
          ":now": DynamoAttributeValue.fromString(JsonPath.stringAt("$$.State.EnteredTime")),
          ":reason": DynamoAttributeValue.fromString(JsonPath.stringAt("$.result.reason")),
        },
        resultPath: JsonPath.DISCARD,
      });

    const completed = save("SaveCompleted", "completed");
    const empty = save("SaveEmpty", "empty");
    const review = save("SaveNeedsReview", "needs_review");
    const failed = save("SaveFailed", "failed");
    completed.next(publish("PublishCompleted", "LocalizationJobCompleted")).next(done);
    empty.next(publish("PublishEmpty", "LocalizationJobEmpty")).next(done);
    review.next(publish("PublishNeedsReview", "LocalizationJobNeedsReview")).next(done);
    failed.next(publish("PublishFailed", "LocalizationJobFailed")).next(done);

    outcome
      .when(Condition.stringEquals("$.result.status", "completed"), completed)
      .when(Condition.stringEquals("$.result.status", "empty"), empty)
      .when(Condition.stringEquals("$.result.status", "needs_review"), review)
      .otherwise(failed);

    const normalize = new Pass(this, stateId("NormalizeCue"), {
      parameters: {
        status: JsonPath.stringAt("$.cues.Payload.status"),
        sourceLanguage: JsonPath.stringAt("$.cues.Payload.sourceLanguage"),
        reason: JsonPath.stringAt("$.cues.Payload.reason"),
        outputs: JsonPath.objectAt("$.cues.Payload.outputs"),
      },
      resultPath: "$.result",
    });
    normalize.next(outcome);

    const cue = new LambdaInvoke(this, stateId("BuildSubtitles"), {
      lambdaFunction: cueFunction,
      payload: taskPayload(),
      resultPath: "$.cues",
    });
    const buildFailed = new Pass(this, stateId("NormalizeBuildFailure"), {
      parameters: {
        status: "failed",
        sourceLanguage: "",
        reason: JsonPath.stringAt("$.cueError.Cause"),
        outputs: [],
      },
      resultPath: "$.result",
    });
    buildFailed.next(outcome);
    cue.addCatch(buildFailed, { resultPath: "$.cueError" });
    cue.next(normalize);

    const transcriptFailed = new Pass(this, stateId("NormalizeTranscriptFailure"), {
      parameters: {
        status: "failed",
        sourceLanguage: "",
        reason: JsonPath.stringAt("$.transcript.failureReason"),
        outputs: [],
      },
      resultPath: "$.result",
    });
    transcriptFailed.next(outcome);

    const timedOut = new Pass(this, stateId("NormalizeTimeout"), {
      parameters: {
        status: "failed",
        sourceLanguage: "",
        reason: "Transcription did not finish before the wait ended.",
        outputs: [],
      },
      resultPath: "$.result",
    });
    timedOut.next(outcome);

    const startFailed = new Pass(this, stateId("NormalizeStartFailure"), {
      parameters: {
        status: "failed",
        sourceLanguage: "",
        reason: JsonPath.stringAt("$.startError.Cause"),
        outputs: [],
      },
      resultPath: "$.result",
    });
    startFailed.next(outcome);
    const waitFailed = new Pass(this, stateId("NormalizeWaitFailure"), {
      parameters: {
        status: "failed",
        sourceLanguage: "",
        reason: "The workflow could not wait for the transcript.",
        outputs: [],
      },
      resultPath: "$.result",
    });
    waitFailed.next(outcome);

    const lookup = (name: string) =>
      new CallAwsService(this, stateId(name), {
        service: "transcribe",
        action: "getTranscriptionJob",
        iamResources: [jobArn],
        parameters: { TranscriptionJobName: JsonPath.stringAt("$.transcriptionJobName") },
        resultPath: "$.lookup",
      });

    const afterTimeout = lookup("GetAfterTimeout");
    afterTimeout.addCatch(timedOut, { resultPath: "$.lookupError" });
    afterTimeout.next(
      new Choice(this, stateId("TimeoutStatus"))
        .when(Condition.stringEquals("$.lookup.TranscriptionJob.TranscriptionJobStatus", "COMPLETED"), cue)
        .otherwise(timedOut),
    );

    const afterStart = lookup("GetAfterStartError");
    afterStart.addCatch(startFailed, { resultPath: "$.lookupError" });

    const afterWait = new Choice(this, stateId("AfterTranscript"))
      .when(Condition.stringEquals("$.transcript.status", "COMPLETED"), cue)
      .otherwise(transcriptFailed);

    const waitForTranscript = new LambdaInvoke(this, stateId("WaitForTranscriptReady"), {
      lambdaFunction: tokenFunction,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      taskTimeout: Timeout.duration(Duration.hours(4)),
      payload: taskPayload(true),
      resultPath: "$.transcript",
    });
    waitForTranscript.addCatch(afterTimeout, { errors: ["States.Timeout"], resultPath: "$.waitError" });
    waitForTranscript.addCatch(waitFailed, { resultPath: "$.waitError" });
    waitForTranscript.next(afterWait);

    const start = (name: string, mode: "plain" | "speakers" | "multi" | "forced-plain" | "forced-speakers") => {
      const task = new CallAwsService(this, stateId(name), {
        service: "transcribe",
        action: "startTranscriptionJob",
        iamResources: [jobArn],
        parameters: transcriptionParameters(mode, transcriptSubtitleBucket.bucketName, languages),
        resultPath: JsonPath.DISCARD,
      });
      task.addRetry({
        errors: ["Transcribe.ThrottlingException", "Transcribe.LimitExceededException"],
        interval: Duration.seconds(20),
        maxAttempts: 4,
        backoffRate: 2,
      });
      task.addCatch(afterStart, { resultPath: "$.startError" });
      task.next(waitForTranscript);
      return task;
    };

    const highlights = start("StartHighlights", "plain");
    const speakers = start("StartSpeakers", "speakers");
    const multi = start("StartMulti", "multi");
    const forcedPlain = start("StartForcedPlain", "forced-plain");
    const forcedSpeakers = start("StartForcedSpeakers", "forced-speakers");

    afterStart.next(
      new Choice(this, stateId("StartErrorStatus"))
        .when(Condition.stringEquals("$.lookup.TranscriptionJob.TranscriptionJobStatus", "COMPLETED"), cue)
        .when(Condition.stringEquals("$.lookup.TranscriptionJob.TranscriptionJobStatus", "IN_PROGRESS"), waitForTranscript)
        .when(Condition.stringEquals("$.lookup.TranscriptionJob.TranscriptionJobStatus", "QUEUED"), waitForTranscript)
        .otherwise(startFailed),
    );

    const unknownMode = new Fail(this, stateId("UnknownMode"), { cause: "The profile mode is not supported" });
    const detected = new Choice(this, stateId("DetectedMode"))
      .when(Condition.stringEquals("$.mode", "highlights"), highlights)
      .when(Condition.stringEquals("$.mode", "speakers"), speakers)
      .when(Condition.stringEquals("$.mode", "multi"), multi)
      .otherwise(unknownMode);
    const route = new Choice(this, stateId("Route"))
      .when(
        Condition.isPresent("$.forceLanguage"),
        new Choice(this, stateId("ForcedMode")).when(Condition.stringEquals("$.mode", "highlights"), forcedPlain).otherwise(forcedSpeakers),
      )
      .otherwise(detected);

    const markRunning = new DynamoUpdateItem(this, stateId("MarkRunning"), {
      table: jobTable,
      key: { jobId: DynamoAttributeValue.fromString(JsonPath.stringAt("$.jobId")) },
      updateExpression: "SET #status = :running, updatedAt = :now, executionName = :execution REMOVE failureReason",
      conditionExpression: "#status = :received OR #status = :running",
      expressionAttributeNames: { "#status": "status" },
      expressionAttributeValues: {
        ":running": DynamoAttributeValue.fromString("running"),
        ":received": DynamoAttributeValue.fromString("received"),
        ":now": DynamoAttributeValue.fromString(JsonPath.stringAt("$$.State.EnteredTime")),
        ":execution": DynamoAttributeValue.fromString(JsonPath.stringAt("$$.Execution.Name")),
      },
      resultPath: JsonPath.DISCARD,
    });
    markRunning.next(prepareMedia(this, stateId, props.audioExtractRoleArn, route, cue, outcome));

    this.workflowLogs = new LogGroup(this, stateId("WorkflowLogs"), {
      logGroupName: `/aws/vendedlogs/states/${stateMachineName}`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy,
    });
    this.stateMachine = new StateMachine(this, stateId("Workflow"), {
      stateMachineName: stateMachineName,
      stateMachineType: StateMachineType.STANDARD,
      definitionBody: DefinitionBody.fromChainable(markRunning),
      tracingEnabled: true,
      timeout: Duration.hours(6),
      logs: { destination: this.workflowLogs, level: LogLevel.ALL, includeExecutionData: false },
    });
    NagSuppressions.addResourceSuppressions(
      this.stateMachine,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "The workflow updates one job row by id. The DynamoDB integration also lists the table indexes, which this workflow does not query.",
          appliesTo: [{ regex: "/Resource::<.*Arn>\\/index\\/\\*/" }],
        },
        {
          id: "AwsSolutions-IAM5",
          reason: "Transcription job names are the job id, assigned when a video arrives.",
          appliesTo: [{ regex: "/Resource::.*transcription-job\\/.*/" }],
        },
        {
          id: "AwsSolutions-IAM5",
          reason: "X-Ray trace segments have no resource ARN. MediaConvert CreateJob, GetJob, and CancelJob also have no job ARN until the extract exists.",
          appliesTo: ["Resource::*"],
        },
        {
          id: "AwsSolutions-IAM5",
          reason: "Step Functions invokes a specific function version. The version suffix is added when the function is published.",
          appliesTo: [{ regex: "/Resource::<(StoreTranscribeTaskToken|WriteTranslatedSubtitles)[^.]*\\.Arn>:\\*/" }],
        },
      ],
      true,
    );
  }
}

/** Sends an accepted transcript straight to subtitles, and extracts audio when the MP4 is over Transcribe's 2 GiB limit. */
function prepareMedia(
  scope: Construct,
  stateId: (name: string) => string,
  roleArn: string,
  route: Choice,
  cue: LambdaInvoke,
  outcome: Choice,
): Choice {
  const useExtractedAudio = new Pass(scope, stateId("UseExtractedAudio"), {
    inputPath: "$.audioUri",
    resultPath: "$.mediaUri",
  });
  useExtractedAudio.next(route);

  const extractFailed = new Pass(scope, stateId("NormalizeExtractFailure"), {
    parameters: {
      status: "failed",
      sourceLanguage: "",
      reason: JsonPath.stringAt("$.extractError.Cause"),
      outputs: [],
    },
    resultPath: "$.result",
  });
  extractFailed.next(outcome);

  const extract = new MediaConvertCreateJob(scope, stateId("ExtractAudio"), {
    integrationPattern: IntegrationPattern.RUN_JOB,
    resultPath: "$.extract",
    createJobRequest: {
      Role: roleArn,
      Settings: {
        TimecodeConfig: { Source: "ZEROBASED" },
        Inputs: [
          {
            "FileInput.$": "$.mediaUri",
            AudioSelectors: {
              "Audio Selector 1": {
                Offset: 0,
                DefaultSelection: "DEFAULT",
                ProgramSelection: 1,
              },
            },
          },
        ],
        OutputGroups: [
          {
            Name: "Audio",
            OutputGroupSettings: {
              Type: "FILE_GROUP_SETTINGS",
              FileGroupSettings: { "Destination.$": "$.audioDestination" },
            },
            Outputs: [
              {
                ContainerSettings: { Container: "RAW" },
                AudioDescriptions: [
                  {
                    AudioSourceName: "Audio Selector 1",
                    CodecSettings: {
                      Codec: "MP3",
                      Mp3Settings: {
                        RateControlMode: "CBR",
                        Bitrate: 96000,
                        SampleRate: 48000,
                        Channels: 1,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
  extract.addCatch(extractFailed, { resultPath: "$.extractError" });
  extract.next(useExtractedAudio);

  return new Choice(scope, stateId("PrepareMedia"))
    .when(Condition.booleanEquals("$.acceptDetected", true), cue)
    .when(Condition.numberGreaterThan("$.objectSize", TRANSCRIBE_MAX_BYTES), extract)
    .otherwise(route);
}

/** The event body other teams receive. It carries keys, not presigned URLs. */
function eventDetail(): TaskInput {
  return TaskInput.fromObject({
    version: 1,
    jobId: JsonPath.stringAt("$.jobId"),
    profile: JsonPath.stringAt("$.profile"),
    status: JsonPath.stringAt("$.result.status"),
    sourceLanguage: JsonPath.stringAt("$.result.sourceLanguage"),
    reason: JsonPath.stringAt("$.result.reason"),
    outputs: JsonPath.objectAt("$.result.outputs"),
  });
}

/** The payload passed into the token and cue Lambdas. The token step also receives the task token. */
function taskPayload(includeToken = false): TaskInput {
  return TaskInput.fromObject({
    jobId: JsonPath.stringAt("$.jobId"),
    transcriptionJobName: JsonPath.stringAt("$.transcriptionJobName"),
    transcriptKey: JsonPath.stringAt("$.transcriptKey"),
    ...(includeToken ? { taskToken: JsonPath.taskToken } : {}),
  });
}

/** Transcribe settings for language detection, speaker labels, or a forced language. */
function transcriptionParameters(
  mode: "plain" | "speakers" | "multi" | "forced-plain" | "forced-speakers",
  bucketName: string,
  languages: string[],
): Record<string, unknown> {
  const parameters: Record<string, unknown> = {
    TranscriptionJobName: JsonPath.stringAt("$.transcriptionJobName"),
    Media: { MediaFileUri: JsonPath.stringAt("$.mediaUri") },
    OutputBucketName: bucketName,
    OutputKey: JsonPath.stringAt("$.transcriptKey"),
  };
  if (mode === "forced-plain" || mode === "forced-speakers") {
    parameters.LanguageCode = JsonPath.stringAt("$.forceLanguage");
  } else if (mode === "multi") {
    parameters.IdentifyMultipleLanguages = true;
    parameters.LanguageOptions = languages;
  } else {
    parameters.IdentifyLanguage = true;
    parameters.LanguageOptions = languages;
  }
  if (mode === "speakers" || mode === "multi" || mode === "forced-speakers") {
    parameters.Settings = {
      ShowSpeakerLabels: true,
      MaxSpeakerLabels: JsonPath.numberAt("$.maxSpeakers"),
    };
  }
  return parameters;
}
