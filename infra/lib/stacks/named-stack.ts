/**
 * Base stack that tags every resource with the service, name, owner, and stage.
 */

import { Stack, type StackProps, Tags } from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { StageConfig, StageName } from "../utils/schema";

export interface AppStackProps extends StackProps {
  stage: StageName;
  config: StageConfig;
}

export class NamedStack extends Stack {
  protected readonly stage: StageName;
  protected readonly config: StageConfig;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { stage, config } = props;
    this.stage = stage;
    this.config = config;
    Tags.of(this).add("Service", config.service);
    Tags.of(this).add("Name", config.name);
    Tags.of(this).add("Owner", config.owner);
    Tags.of(this).add("Stage", stage);
  }
}
