/**
 * Checks the stage YAML before a stack is synthesized.
 * Dev and prod are the only stages.
 */

import { z } from "zod";

const profileSchema = z
  .object({
    speakerLabels: z.boolean(),
    maxSpeakers: z.number().int().min(2).max(30).optional(),
    multiLanguage: z.boolean().optional(),
  })
  .superRefine((profile, ctx) => {
    if (profile.speakerLabels && profile.maxSpeakers === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maxSpeakers is required when speakerLabels is true",
        path: ["maxSpeakers"],
      });
    }
  });

export const stageConfigSchema = z.object({
  service: z.string().regex(/^[a-z][a-z0-9-]{1,20}$/),
  name: z.string().regex(/^[a-z][a-z0-9-]{1,20}$/),
  owner: z.string().min(1),
  removalPolicy: z.enum(["destroy", "retain"]),
  budgetUsd: z.number().positive().max(1000),
  features: z.object({
    deployCustomDomain: z.boolean(),
    audioNormalization: z.boolean(),
    burnInCaptions: z.boolean(),
    realtimeStatus: z.enum(["poll"]),
  }),
  languages: z.object({
    candidates: z.array(z.string().min(2)).min(2).max(5),
    outputs: z.array(z.string().regex(/^[a-z]{2}$/)).min(1),
  }),
  profiles: z.record(profileSchema).refine((profiles) => Object.keys(profiles).length > 0, {
    message: "at least one profile is required",
  }),
  defaultProfile: z.string().min(1),
  runtime: z.object({
    cueMaxChars: z.number().int().positive(),
    cueMaxLines: z.number().int().positive(),
    pollIntervalSeconds: z.number().int().positive(),
    languageConfidenceMin: z.number().gt(0).lte(1),
  }),
}).superRefine((config, ctx) => {
  if (!config.profiles[config.defaultProfile]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `defaultProfile "${config.defaultProfile}" is not defined`,
      path: ["defaultProfile"],
    });
  }
});

export type StageConfig = z.infer<typeof stageConfigSchema>;
export type StageName = "dev" | "prod";

export const STAGES = ["dev", "prod"] as const;

/** True when the value is dev or prod. */
export function isStageName(value: string): value is StageName {
  return (STAGES as readonly string[]).includes(value);
}
