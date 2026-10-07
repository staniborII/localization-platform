/**
 * Private buckets for uploads, transcripts, and subtitle files, plus the jobs table.
 */

import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, ProjectionType, Table, TableEncryption } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";
import { resourceName, stagified } from "../utils";
import { NamedStack, type AppStackProps } from "./named-stack";

export class DataStack extends NamedStack {
  readonly videoUploadBucket: Bucket;
  readonly transcriptSubtitleBucket: Bucket;
  readonly logBucket: Bucket;
  readonly jobTable: Table;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { stage, config } = props;
    const parts = { service: config.service, name: config.name };
    const removal = config.removalPolicy === "destroy" ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;

    this.logBucket = new Bucket(this, stagified("MediaAccessLogs", stage), {
      bucketName: resourceName(parts, "MediaAccessLogs", stage),
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      removalPolicy: removal,
      autoDeleteObjects: removal === RemovalPolicy.DESTROY,
    });
    NagSuppressions.addResourceSuppressions(
      this.logBucket,
      [
        {
          id: "AwsSolutions-S1",
          reason: "This bucket stores access logs for the media and site buckets. It does not log to itself.",
        },
      ],
      true,
    );

    this.videoUploadBucket = this.mediaBucket("VideoUploadBucket", "VideoUploadBucket", removal);
    this.videoUploadBucket.addCorsRule({
      allowedOrigins: ["*"],
      allowedMethods: [HttpMethods.PUT, HttpMethods.HEAD],
      allowedHeaders: ["*"],
      exposedHeaders: ["ETag"],
      maxAge: 3000,
    });
    this.transcriptSubtitleBucket = this.mediaBucket("TranscriptSubtitleBucket", "TranscriptSubtitleBucket", removal);
    this.transcriptSubtitleBucket.addCorsRule({
      allowedOrigins: ["*"],
      allowedMethods: [HttpMethods.GET, HttpMethods.HEAD],
      allowedHeaders: ["*"],
      maxAge: 3000,
    });

    const account = this.account;
    this.videoUploadBucket.addToResourcePolicy(
      new PolicyStatement({
        principals: [new ServicePrincipal("transcribe.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [this.videoUploadBucket.arnForObjects("video-upload/*")],
        conditions: { StringEquals: { "aws:SourceAccount": account } },
      }),
    );
    this.transcriptSubtitleBucket.addToResourcePolicy(
      new PolicyStatement({
        principals: [new ServicePrincipal("transcribe.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [this.transcriptSubtitleBucket.arnForObjects("transcripts/*")],
        conditions: { StringEquals: { "aws:SourceAccount": account } },
      }),
    );
    this.transcriptSubtitleBucket.addToResourcePolicy(
      new PolicyStatement({
        principals: [new ServicePrincipal("transcribe.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [this.transcriptSubtitleBucket.arnForObjects("audio/*")],
        conditions: { StringEquals: { "aws:SourceAccount": account } },
      }),
    );

    this.jobTable = new Table(this, stagified("JobTable", stage), {
      tableName: resourceName(parts, "JobTable", stage),
      partitionKey: { name: "jobId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: removal,
      deletionProtection: removal === RemovalPolicy.RETAIN,
    });
    this.jobTable.addGlobalSecondaryIndex({
      indexName: "recent",
      partitionKey: { name: "listPk", type: AttributeType.STRING },
      sortKey: { name: "updatedAt", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
    this.jobTable.addGlobalSecondaryIndex({
      indexName: "status",
      partitionKey: { name: "status", type: AttributeType.STRING },
      sortKey: { name: "updatedAt", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }

  private mediaBucket(id: string, purpose: string, removal: RemovalPolicy): Bucket {
    const bucket = new Bucket(this, stagified(id, this.stage), {
      bucketName: resourceName({ service: this.config.service, name: this.config.name }, purpose, this.stage),
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      eventBridgeEnabled: purpose === "VideoUploadBucket",
      serverAccessLogsBucket: this.logBucket,
      serverAccessLogsPrefix: `${purpose}/`,
      removalPolicy: removal,
      autoDeleteObjects: removal === RemovalPolicy.DESTROY,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
        { noncurrentVersionExpiration: Duration.days(30) },
      ],
    });
    return bucket;
  }
}
