/**
 * Creates the four localization stacks and passes the buckets, the job table, and the state machine between them.
 */

import { Aspects, CfnResource } from "aws-cdk-lib";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";
import { resourceName, stagified } from "../utils";
import { DataStack } from "./data-stack";
import { LocalizationPipelineStack } from "./localization-pipeline-stack";
import { MonitoringStack } from "./monitoring-stack";
import { WebClientStack } from "./web-client-stack";
import { NamedStack, type AppStackProps } from "./named-stack";

export class LocalizationStack extends NamedStack {
  readonly data: DataStack;
  readonly pipeline: LocalizationPipelineStack;
  readonly monitoring: MonitoringStack;
  readonly webClient: WebClientStack;

  /** Builds the four stacks and records which one must deploy before the next. */
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { stage, config, env } = props;
    const parts = { service: config.service, name: config.name };
    const shared = { env, stage, config };

    this.data = new DataStack(this, stagified("DataStack", stage), {
      ...shared,
      stackName: resourceName(parts, "data", stage),
      description: "Media buckets and job state.",
    });

    this.pipeline = new LocalizationPipelineStack(this, stagified("LocalizationPipelineStack", stage), {
      ...shared,
      stackName: resourceName(parts, "pipeline", stage),
      description: "Localization workflow.",
      videoUploadBucket: this.data.videoUploadBucket,
      transcriptSubtitleBucket: this.data.transcriptSubtitleBucket,
      jobTable: this.data.jobTable,
    });
    this.pipeline.addStackDependency(this.data);

    this.monitoring = new MonitoringStack(this, stagified("MonitoringStack", stage), {
      ...shared,
      stackName: resourceName(parts, "monitoring", stage),
      description: "Alarms, dashboard, and budget.",
      stateMachine: this.pipeline.workflow.stateMachine,
      workflowLogs: this.pipeline.workflow.workflowLogs,
      deadLetterQueues: this.pipeline.deadLetterQueues,
    });
    this.monitoring.addStackDependency(this.pipeline);

    this.webClient = new WebClientStack(this, stagified("WebClientStack", stage), {
      ...shared,
      stackName: resourceName(parts, "web-client", stage),
      description: "Static web client and upload API.",
      videoUploadBucket: this.data.videoUploadBucket,
      transcriptSubtitleBucket: this.data.transcriptSubtitleBucket,
      logBucket: this.data.logBucket,
      jobTable: this.data.jobTable,
      stateMachine: this.pipeline.workflow.stateMachine,
    });
    this.webClient.addStackDependency(this.pipeline);
    this.webClient.addStackDependency(this.data);

    suppressFrameworkHandlers(this);
    Aspects.of(this).add(new AwsSolutionsChecks({ verbose: true }));
  }
}

/** cdk-nag exceptions for the S3 handlers that CDK itself creates. */
function suppressFrameworkHandlers(scope: Construct): void {
  for (const child of scope.node.findAll()) {
    if (!(child instanceof CfnResource)) {
      continue;
    }
    const resourcePath = child.node.path;
    if (
      !resourcePath.includes("BucketNotificationsHandler") &&
      !resourcePath.includes("Custom::S3AutoDeleteObjects") &&
      !resourcePath.includes("CDKBucketDeployment")
    ) {
      continue;
    }
    NagSuppressions.addResourceSuppressions(
      child,
      [
        {
          id: "AwsSolutions-IAM4",
          reason: "This role belongs to a CDK custom resource. The framework owns its basic logging policy.",
          appliesTo: ["Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"],
        },
        {
          id: "AwsSolutions-IAM5",
          reason: "The CDK deployment and auto-delete handlers list and delete objects in buckets this app created.",
        },
        {
          id: "AwsSolutions-L1",
          reason: "The runtime is chosen by the AWS CDK custom resource, not by this application.",
        },
      ],
      true,
    );
  }
}
