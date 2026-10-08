/**
 * Hosts the static web client and the upload and status function URLs on one CloudFront hostname.
 */

import path from "node:path";
import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  OriginRequestPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { FunctionUrlAuthType } from "aws-cdk-lib/aws-lambda";
import type { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import type { IStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";
import { runtimeConfigValue } from "../shared/environment";
import { serviceFunction } from "../shared/function";
import { resourceName, stagified } from "../utils";
import { ensureSiteExport } from "../web-client/site-export";
import { NamedStack, type AppStackProps } from "./named-stack";

export interface WebClientStackProps extends AppStackProps {
  videoUploadBucket: IBucket;
  transcriptSubtitleBucket: IBucket;
  logBucket: IBucket;
  jobTable: ITable;
  stateMachine: IStateMachine;
}

export class WebClientStack extends NamedStack {
  constructor(scope: Construct, id: string, props: WebClientStackProps) {
    super(scope, id, props);
    const { stage, config, videoUploadBucket, transcriptSubtitleBucket, logBucket, jobTable, stateMachine } = props;
    const parts = { service: config.service, name: config.name };
    const removal = config.removalPolicy === "destroy" ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;
    const shared = {
      CONFIG: runtimeConfigValue(config),
      TABLE_NAME: jobTable.tableName,
      VIDEO_UPLOAD_BUCKET: videoUploadBucket.bucketName,
      TRANSCRIPT_SUBTITLE_BUCKET: transcriptSubtitleBucket.bucketName,
      STATE_MACHINE_ARN: stateMachine.stateMachineArn,
    };

    const presign = serviceFunction(this, "Presign", {
      stage,
      functionName: resourceName(parts, "presign", stage),
      entry: path.join(__dirname, "../lambda/upload/handler.ts"),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: shared,
      removalPolicy: removal,
    });
    presign.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [videoUploadBucket.arnForObjects("video-upload/*")],
      }),
    );
    presign.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:GetItem"],
        resources: [jobTable.tableArn],
      }),
    );

    const status = serviceFunction(this, "Status", {
      stage,
      functionName: resourceName(parts, "status", stage),
      entry: path.join(__dirname, "../lambda/status/handler.ts"),
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment: shared,
      removalPolicy: removal,
    });
    status.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
        resources: [jobTable.tableArn],
      }),
    );
    status.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [`${jobTable.tableArn}/index/recent`, `${jobTable.tableArn}/index/status`],
      }),
    );
    status.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [videoUploadBucket.arnForObjects("video-upload/*"), transcriptSubtitleBucket.arnForObjects("subtitles/*")],
      }),
    );
    status.addToRolePolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [stateMachine.stateMachineArn],
      }),
    );
    stateMachine.grantExecution(status, "states:DescribeExecution", "states:GetExecutionHistory");
    status.addToRolePolicy(
      new PolicyStatement({
        actions: ["states:ListExecutions", "states:SendTaskSuccess"],
        resources: [stateMachine.stateMachineArn],
      }),
    );
    status.addToRolePolicy(
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

    const uploads = presign.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });
    const jobs = status.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });
    // Every viewer header except Host, so the POST body hash is included. Compression stays off so CloudFront signs the request the function URL checks.
    const apiOrigin = {
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: false,
    };

    const site = new Bucket(this, stagified("WebClientBucket", stage), {
      bucketName: resourceName(parts, "WebClientBucket", stage),
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: "site/",
      removalPolicy: removal,
      autoDeleteObjects: removal === RemovalPolicy.DESTROY,
    });

    const rewrite = new Function(this, stagified("AppendIndexHtml", stage), {
      code: FunctionCode.fromInline(`function handler(event) {
        var request = event.request;
        var uri = request.uri;
        if (uri.endsWith("/")) {
          request.uri += "index.html";
        } else if (uri.indexOf(".") === -1) {
          request.uri += ".html";
        }
        return request;
      }`),
      runtime: FunctionRuntime.JS_2_0,
    });

    const distribution = new Distribution(this, stagified("WebClientDistribution", stage), {
      comment: "Localization web client and upload API",
      defaultRootObject: "index.html",
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
        functionAssociations: [{ function: rewrite, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        "/api/uploads": { ...apiOrigin, origin: FunctionUrlOrigin.withOriginAccessControl(uploads) },
        "/api/jobs*": { ...apiOrigin, origin: FunctionUrlOrigin.withOriginAccessControl(jobs) },
      },
    });
    this.allowCloudFrontInvoke(presign, distribution);
    this.allowCloudFrontInvoke(status, distribution);

    NagSuppressions.addResourceSuppressions(distribution, [
      {
        id: "AwsSolutions-CFR3",
        reason: "CloudFront standard logs need a bucket ACL. These buckets block ACLs. S3 server access logs cover the site bucket.",
      },
      {
        id: "AwsSolutions-CFR4",
        reason: "The default CloudFront certificate stays until deployCustomDomain is true. Viewer requests still redirect to HTTPS.",
      },
      {
        id: "AwsSolutions-CFR1",
        reason: "Country blocks are a distribution choice for the media platform. This web client is a demo on the default hostname.",
      },
      {
        id: "AwsSolutions-CFR2",
        reason: "A web application firewall is a monthly charge. It stays off until deployCustomDomain is true.",
      },
    ]);
    NagSuppressions.addResourceSuppressions(
      presign.role!,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "Uploaded object names include a random id under the video-upload prefix.",
          appliesTo: [{ regex: "/Resource::<.*Arn>\\/video-upload\\/\\*/" }],
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(
      status.role!,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "Playback objects are named by job id under fixed prefixes.",
          appliesTo: [{ regex: "/Resource::<.*Arn>\\/(video-upload|subtitles)\\/\\*/" }],
        },
        {
          id: "AwsSolutions-IAM5",
          reason: "The job page reads the execution named on the job row. That name is chosen when a run starts, so the role covers every execution of this state machine.",
          appliesTo: [{ regex: "/Resource::arn:.*:states:.*:execution:.*:\\*/" }],
        },
        {
          id: "AwsSolutions-IAM5",
          reason: "Transcription job names are the job id, assigned when a video arrives. Continue checks that job before waking the wait.",
          appliesTo: [{ regex: "/Resource::.*transcription-job\\/.*/" }],
        },
      ],
      true,
    );
    new BucketDeployment(this, stagified("SiteAssets", stage), {
      sources: [Source.asset(ensureSiteExport())],
      destinationBucket: site,
      distribution,
      distributionPaths: ["/*"],
      memoryLimit: 512,
      prune: true,
    });

    new CfnOutput(this, stagified("ConsoleUrl", stage), { value: `https://${distribution.distributionDomainName}` });
  }

  /** Lets CloudFront invoke the function. The URL permission alone is refused. */
  private allowCloudFrontInvoke(fn: NodejsFunction, distribution: Distribution): void {
    fn.addPermission(stagified("CloudFrontInvoke", this.stage), {
      principal: new ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: distribution.distributionArn,
    });
  }
}
