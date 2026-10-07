/**
 * Loads config.<stage>.yml and the account and region from the environment.
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { isStageName, stageConfigSchema, type StageConfig, type StageName } from "./schema";

export interface LoadedConfig {
  stage: StageName;
  account: string;
  region: string;
  config: StageConfig;
}

/** Reads STAGE, the account, and the region from the environment, then parses the matching YAML file. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, infraRoot = path.join(__dirname, "..", "..")): LoadedConfig {
  const stageValue = env.STAGE?.trim();
  if (!stageValue || !isStageName(stageValue)) {
    throw new Error("STAGE must be dev or prod");
  }

  const account = env.AWS_ACCOUNT_ID?.trim();
  const region = env.AWS_REGION?.trim();
  if (!account || !region) {
    throw new Error("AWS_ACCOUNT_ID and AWS_REGION are required");
  }

  const filePath = path.join(infraRoot, "config", `config.${stageValue}.yml`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing stage config: ${filePath}`);
  }

  const parsed = stageConfigSchema.parse(parse(fs.readFileSync(filePath, "utf8")));
  return { stage: stageValue, account, region, config: parsed };
}
