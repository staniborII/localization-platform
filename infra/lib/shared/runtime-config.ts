/**
 * Reads the languages, profiles, and cue settings the stack placed in the CONFIG variable.
 */

import type { ProfileSettings } from "../transcription/build-transcription-input";

export interface PipelineConfig {
  profiles: Record<string, ProfileSettings>;
  languages: { candidates: string[]; outputs: string[] };
  runtime: {
    cueMaxChars: number;
    cueMaxLines: number;
    pollIntervalSeconds: number;
    languageConfidenceMin: number;
  };
  defaultProfile: string;
}

/** Parses CONFIG and rejects a payload that is missing profiles, languages, or cue settings. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  const raw = env.CONFIG;
  if (!raw) {
    throw new Error("CONFIG is not set");
  }
  const parsed = JSON.parse(raw) as PipelineConfig;
  if (!parsed.profiles || !parsed.languages?.outputs || !parsed.runtime) {
    throw new Error("CONFIG is incomplete");
  }
  return parsed;
}

/** Maps a Transcribe code such as en-US to the subtitle language en. */
export function baseLanguage(code: string | undefined): string | undefined {
  if (!code) {
    return undefined;
  }
  const base = code.toLowerCase().split("-")[0];
  return base || undefined;
}
