/**
 * Builds the CONFIG JSON that CDK writes onto each Lambda.
 */

import type { StageConfig } from "../utils/schema";

/** Keeps the slice of the stage file that handlers read at runtime. */
export function runtimeConfigValue(config: StageConfig): string {
  return JSON.stringify({
    profiles: config.profiles,
    languages: config.languages,
    runtime: config.runtime,
    defaultProfile: config.defaultProfile,
  });
}
