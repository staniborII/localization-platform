/**
 * Loads the stage from .env and creates the localization stack.
 */

import path from "node:path";
import { App } from "aws-cdk-lib";
import dotenv from "dotenv";
import { loadConfig } from "../lib/utils/config";
import { LocalizationStack } from "../lib/stacks/localization-stack";
import { resourceName, stagified } from "../lib/utils";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const { stage, config, account, region } = loadConfig();
const app = new App();

new LocalizationStack(app, stagified("LocalizationStack", stage), {
  stackName: resourceName({ service: config.service, name: config.name }, "app", stage),
  env: { account, region },
  stage,
  config,
  description: "Media buckets, the localization pipeline, alarms, and the web client.",
});

app.synth();
