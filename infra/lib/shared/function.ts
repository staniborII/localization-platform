/**
 * Creates one Lambda with its own role and log group.
 * The entry file must export a function named handler.
 */

import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";
import { stagified } from "../utils";

export interface ServiceFunctionProps {
  stage: string;
  functionName: string;
  entry: string;
  timeout: Duration;
  memorySize: number;
  environment: Record<string, string>;
  removalPolicy: RemovalPolicy;
}

/** Builds the function, the log group, and a role that can write only to that log group. Each construct id includes the stage. */
export function serviceFunction(scope: Construct, id: string, props: ServiceFunctionProps): NodejsFunction {
  const { stage, functionName, entry, timeout, memorySize, environment, removalPolicy } = props;
  const logGroup = new LogGroup(scope, stagified(`${id}Logs`, stage), {
    logGroupName: `/aws/lambda/${functionName}`,
    retention: RetentionDays.ONE_MONTH,
    removalPolicy,
  });
  const role = new Role(scope, stagified(`${id}Role`, stage), {
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
  });
  role.addToPolicy(
    new PolicyStatement({
      actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
      resources: [`${logGroup.logGroupArn}:*`],
    }),
  );
  NagSuppressions.addResourceSuppressions(
    role,
    [
      {
        id: "AwsSolutions-IAM5",
        reason: "CloudWatch assigns the log stream name when the function writes its first event.",
        appliesTo: [{ regex: "/Resource::<.*Logs.*Arn>:\\*/" }],
      },
    ],
    true,
  );

  return new NodejsFunction(scope, stagified(id, stage), {
    functionName,
    entry,
    handler: "handler",
    runtime: Runtime.NODEJS_24_X,
    architecture: Architecture.ARM_64,
    memorySize,
    timeout,
    environment,
    role,
    logGroup,
    bundling: { externalModules: ["@aws-sdk/*"] },
  });
}
