/**
 * Wires the Lambdas, the state machine, and the platform events for one localization run.
 */

import path from "node:path";
import { ArnFormat, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import { EventBus, Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";
import { LocalizationEvents } from "../platform/events";
import { runtimeConfigValue } from "../shared/environment";
import { serviceFunction } from "../shared/function";
import { resourceName, stagified } from "../utils";
import { LocalizationWorkflow } from "../transcription/step-functions-state-machine";
import { NamedStack, type AppStackProps } from "./named-stack";

export interface LocalizationPipelineStackProps extends AppStackProps {
  videoUploadBucket: IBucket;
  transcriptSubtitleBucket: IBucket;
  jobTable: ITable;
}

export class LocalizationPipelineStack extends NamedStack {
  readonly stateMachineArn: string;
  readonly stateMachineName: string;
  readonly deadLetterQueues: LocalizationEvents["deadLetterQueues"];
  readonly workflow: LocalizationWorkflow;

  constructor(scope: Construct, id: string, props: LocalizationPipelineStackProps) {
    super(scope, id, props);
    const { stage, config, videoUploadBucket, transcriptSubtitleBucket, jobTable } = props;
    const parts = { service: config.service, name: config.name };
    const removal = config.removalPolicy === "destroy" ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;
    const configValue = runtimeConfigValue(config);
    this.stateMachineName = resourceName(parts, "workflow", stage);

    const events = new LocalizationEvents(this, stagified("JobOutcomeEvents", stage), {
      parts,
      stage,
      removalPolicy: removal,
    });
    this.deadLetterQueues = events.deadLetterQueues;

    const shared = { CONFIG: configValue, TABLE_NAME: jobTable.tableName };
    const allowTable = (fn: { addToRolePolicy(statement: PolicyStatement): void }, ...actions: string[]) => {
      fn.addToRolePolicy(new PolicyStatement({ actions, resources: [jobTable.tableArn] }));
    };
    const token = serviceFunction(this, "StoreTranscribeTaskToken", {
      stage,
      functionName: resourceName(parts, "StoreTranscribeTaskToken", stage),
      entry: path.join(__dirname, "../lambda/token/handler.ts"),
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment: shared,
      removalPolicy: removal,
    });
    const cue = serviceFunction(this, "WriteTranslatedSubtitles", {
      stage,
      functionName: resourceName(parts, "WriteTranslatedSubtitles", stage),
      entry: path.join(__dirname, "../lambda/cue/handler.ts"),
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: { ...shared, TRANSCRIPT_SUBTITLE_BUCKET: transcriptSubtitleBucket.bucketName },
      removalPolicy: removal,
    });
    allowTable(token, "dynamodb:UpdateItem");
    allowTable(cue, "dynamodb:GetItem", "dynamodb:UpdateItem");
    cue.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [transcriptSubtitleBucket.arnForObjects("transcripts/*")],
      }),
    );
    cue.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [transcriptSubtitleBucket.arnForObjects("subtitles/*")],
      }),
    );
    cue.addToRolePolicy(
      new PolicyStatement({
        actions: ["transcribe:GetTranscriptionJob"],
        resources: [
          Stack.of(this).formatArn({
            service: "transcribe",
            resource: "transcription-job",
            resourceName: "*",
            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
          }),
        ],
      }),
    );
    cue.addToRolePolicy(
      new PolicyStatement({
        actions: ["translate:TranslateText"],
        resources: ["*"],
      }),
    );
    NagSuppressions.addResourceSuppressions(
      cue.role!,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "Transcript and subtitle object names include the job id, which exists only after a video arrives.",
          appliesTo: [{ regex: "/Resource::<.*Arn>\\/(transcripts|subtitles)\\/\\*/" }],
        },
        {
          id: "AwsSolutions-IAM5",
          reason: "TranslateText does not support a resource ARN for the text being translated.",
          appliesTo: ["Resource::*"],
        },
        {
          id: "AwsSolutions-IAM5",
          reason: "Transcription job names are the job id, assigned when a video arrives.",
          appliesTo: [{ regex: "/Resource::.*transcription-job\\/.*/" }],
        },
      ],
      true,
    );

    const audioExtractRole = new Role(this, stagified("AudioExtractRole", stage), {
      roleName: resourceName(parts, "AudioExtractRole", stage),
      assumedBy: new ServicePrincipal("mediaconvert.amazonaws.com"),
      description: "Reads an uploaded MP4 and writes an audio-only file for Transcribe.",
    });
    audioExtractRole.addToPolicy(
      new PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [videoUploadBucket.arnForObjects("video-upload/*")],
      }),
    );
    audioExtractRole.addToPolicy(
      new PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [transcriptSubtitleBucket.arnForObjects("audio/*")],
      }),
    );
    NagSuppressions.addResourceSuppressions(
      audioExtractRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "Uploaded object names include a random id under the video-upload prefix.",
          appliesTo: [{ regex: "/Resource::<.*Arn>\\/video-upload\\/\\*/" }],
        },
        {
          id: "AwsSolutions-IAM5",
          reason: "The audio-only file is named with the job id, which exists only after a video arrives.",
          appliesTo: [{ regex: "/Resource::<.*Arn>\\/audio\\/\\*/" }],
        },
      ],
      true,
    );

    this.workflow = new LocalizationWorkflow(this, stagified("LocalizationWorkflow", stage), {
      config,
      stage,
      stateMachineName: this.stateMachineName,
      jobTable,
      transcriptSubtitleBucket,
      eventBus: events.bus,
      tokenFunction: token,
      cueFunction: cue,
      removalPolicy: removal,
      audioExtractRoleArn: audioExtractRole.roleArn,
    });
    this.stateMachineArn = this.workflow.stateMachine.stateMachineArn;
    // Transcribe authorizes the caller. The bucket policy for the service does not grant this role.
    this.workflow.stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [videoUploadBucket.arnForObjects("video-upload/*"), transcriptSubtitleBucket.arnForObjects("audio/*")],
      }),
    );
    this.workflow.stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [videoUploadBucket.bucketArn, transcriptSubtitleBucket.bucketArn],
      }),
    );
    this.workflow.stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [transcriptSubtitleBucket.arnForObjects("transcripts/*")],
      }),
    );
    NagSuppressions.addResourceSuppressions(
      this.workflow.stateMachine,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "Transcribe reads the uploaded MP4 or the extracted audio. Those object names include an id assigned when the video arrives.",
          appliesTo: [
            { regex: "/Resource::<.*Arn>\\/video-upload\\/\\*/" },
            { regex: "/Resource::<.*Arn>\\/audio\\/\\*/" },
          ],
        },
        {
          id: "AwsSolutions-IAM5",
          reason: "The transcript object name is the job id, assigned when a video arrives.",
          appliesTo: [{ regex: "/Resource::<.*Arn>\\/transcripts\\/\\*/" }],
        },
      ],
      true,
    );

    const resume = serviceFunction(this, "TranscribeFinishedCallback", {
      stage,
      functionName: resourceName(parts, "TranscribeFinishedCallback", stage),
      entry: path.join(__dirname, "../lambda/resume/handler.ts"),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: shared,
      removalPolicy: removal,
    });
    allowTable(resume, "dynamodb:GetItem");
    resume.addToRolePolicy(
      new PolicyStatement({
        actions: ["states:SendTaskSuccess"],
        resources: [this.stateMachineArn],
      }),
    );

    const starter = serviceFunction(this, "StartWorkflowOnUpload", {
      stage,
      functionName: resourceName(parts, "StartWorkflowOnUpload", stage),
      entry: path.join(__dirname, "../lambda/starter/handler.ts"),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        ...shared,
        STATE_MACHINE_ARN: this.stateMachineArn,
        VIDEO_UPLOAD_BUCKET: videoUploadBucket.bucketName,
        TRANSCRIPT_SUBTITLE_BUCKET: transcriptSubtitleBucket.bucketName,
      },
      removalPolicy: removal,
    });
    allowTable(starter, "dynamodb:PutItem", "dynamodb:GetItem");
    starter.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [videoUploadBucket.arnForObjects("video-upload/*")],
      }),
    );
    starter.addToRolePolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [this.stateMachineArn],
      }),
    );
    NagSuppressions.addResourceSuppressions(
      starter.role!,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "Uploaded object names include a random id under the video-upload prefix.",
          appliesTo: [{ regex: "/Resource::<.*Arn>\\/video-upload\\/\\*/" }],
        },
      ],
      true,
    );
    const defaults = EventBus.fromEventBusName(this, stagified("DefaultBus", stage), "default");
    new Rule(this, stagified("IngressCreated", stage), {
      description: "Starts the localization workflow when a video lands under video-upload/.",
      eventBus: defaults,
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: { name: [videoUploadBucket.bucketName] },
          object: { key: [{ prefix: "video-upload/" }] },
        },
      },
      targets: [new LambdaFunction(starter, { deadLetterQueue: events.uploadEventDlq, retryAttempts: 2 })],
    });
    new Rule(this, stagified("TranscriptReady", stage), {
      description: `Continues ${stagified("WaitForTranscriptReady", stage)} when Transcribe reports the job finished or failed.`,
      eventBus: defaults,
      eventPattern: {
        source: ["aws.transcribe"],
        detailType: ["Transcribe Job State Change"],
        detail: { TranscriptionJobStatus: ["COMPLETED", "FAILED"] },
      },
      targets: [new LambdaFunction(resume, { deadLetterQueue: events.transcribeDlq, retryAttempts: 2 })],
    });
  }
}
