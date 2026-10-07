/**
 * Turns a finished transcript into subtitle files.
 * A cue is one subtitle: the words shown between a start time and an end time.
 * A weak language guess waits for a person to choose. No speech is stored as empty.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetTranscriptionJobCommand, TranscribeClient } from "@aws-sdk/client-transcribe";
import { TranslateClient, TranslateTextCommand } from "@aws-sdk/client-translate";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { baseLanguage, readConfig } from "../../shared/runtime-config";
import type { Cue } from "../../subtitles/cues";
import { groupCues } from "../../subtitles/cues";
import { s3Location } from "../../subtitles/parse-s3-transcript-location";
import { formatSubtitles } from "../../subtitles/generate-subtitle-files";
import { lowestConfidence, spokenLanguages, wordsFromTranscript } from "../../subtitles/transcript";
import { documentClient } from "../dynamodb";
import { required } from "../required-variable";

const s3 = new S3Client({});
const transcribe = new TranscribeClient({});
const translate = new TranslateClient({});

interface CueEvent {
  jobId?: string;
  transcriptionJobName?: string;
  transcriptKey?: string;
}

interface CueResult {
  status: "completed" | "failed" | "needs_review" | "empty";
  sourceLanguage: string;
  reason: string;
  outputs: { lang: string; vttKey: string; srtKey: string }[];
}

/** Reads the transcript, writes one WebVTT file and one SRT file per language, and saves that on the job. */
export async function handler(event: CueEvent): Promise<CueResult> {
  if (!event.jobId || !event.transcriptionJobName) {
    return { status: "failed", sourceLanguage: "", reason: "The subtitle step received an incomplete job.", outputs: [] };
  }
  const config = readConfig();
  const tableName = required("TABLE_NAME");
  const transcriptSubtitleBucket = required("TRANSCRIPT_SUBTITLE_BUCKET");
  const item = await documentClient().send(
    new GetCommand({ TableName: tableName, Key: { jobId: event.jobId }, ConsistentRead: true }),
  );
  const job = item.Item;
  if (!job) {
    return { status: "failed", sourceLanguage: "", reason: "The job row is missing.", outputs: [] };
  }

  const described = await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: event.transcriptionJobName }));
  const jobStatus = described.TranscriptionJob?.TranscriptionJobStatus;
  if (jobStatus !== "COMPLETED") {
    return {
      status: "failed",
      sourceLanguage: "",
      reason: described.TranscriptionJob?.FailureReason ?? "Transcription did not complete.",
      outputs: [],
    };
  }

  const uri = described.TranscriptionJob?.Transcript?.TranscriptFileUri;
  const location = (uri ? s3Location(uri) : undefined) ?? {
    bucket: transcriptSubtitleBucket,
    key: event.transcriptKey ?? `transcripts/${event.transcriptionJobName}.json`,
  };
  const object = await s3.send(new GetObjectCommand({ Bucket: location.bucket, Key: location.key }));
  if (!object.Body) {
    return { status: "failed", sourceLanguage: "", reason: "The transcript file was empty.", outputs: [] };
  }
  const payload = JSON.parse(await object.Body.transformToString()) as unknown;
  const parsed = wordsFromTranscript(payload);
  const forced = typeof job.forcedLanguage === "string" ? job.forcedLanguage : undefined;
  const accepted = job.acceptDetected === true;
  const sourceLanguage = forced || parsed.languageCode || "";
  const confidence = job.mode === "multi" ? (lowestConfidence(payload) ?? parsed.confidence) : parsed.confidence;
  const targets = Array.isArray(job.targetLanguages) ? (job.targetLanguages as string[]) : config.languages.outputs;
  const maxSpeakers = typeof job.maxSpeakers === "number" ? job.maxSpeakers : undefined;
  const speakerSaturation = maxSpeakers !== undefined && (parsed.speakerCount ?? 0) >= maxSpeakers;
  const detected = spokenLanguages(parsed.words);

  await documentClient().send(
    new UpdateCommand({
      TableName: tableName,
      Key: { jobId: event.jobId },
      UpdateExpression:
        "SET sourceLanguage = :language, languageConfidence = :confidence, speakerSaturation = :saturation, detectedLanguages = :detected, updatedAt = :now",
      ExpressionAttributeValues: {
        ":language": sourceLanguage,
        ":confidence": confidence ?? 0,
        ":saturation": speakerSaturation,
        ":detected": detected,
        ":now": new Date().toISOString(),
      },
    }),
  );

  if (!forced && !accepted && confidence !== undefined && confidence < config.runtime.languageConfidenceMin) {
    return {
      status: "needs_review",
      sourceLanguage,
      reason: `Language confidence ${confidence.toFixed(2)} is below ${config.runtime.languageConfidenceMin}.`,
      outputs: [],
    };
  }
  if (parsed.words.length === 0) {
    return { status: "empty", sourceLanguage, reason: "No speech was detected.", outputs: [] };
  }

  const cues = groupCues(parsed.words, config.runtime.cueMaxChars, config.runtime.cueMaxLines);
  const outputs: CueResult["outputs"] = [];
  for (const target of targets) {
    const localized = await localize(cues, target, sourceLanguage);
    const files = formatSubtitles(localized, config.runtime.cueMaxChars, config.runtime.cueMaxLines);
    const vttKey = `subtitles/${event.jobId}/${target}.vtt`;
    const srtKey = `subtitles/${event.jobId}/${target}.srt`;
    await s3.send(new PutObjectCommand({ Bucket: transcriptSubtitleBucket, Key: vttKey, Body: files.vtt, ContentType: "text/vtt; charset=utf-8" }));
    await s3.send(new PutObjectCommand({ Bucket: transcriptSubtitleBucket, Key: srtKey, Body: files.srt, ContentType: "application/x-subrip; charset=utf-8" }));
    outputs.push({ lang: target, vttKey, srtKey });
  }

  await documentClient().send(
    new UpdateCommand({
      TableName: tableName,
      Key: { jobId: event.jobId },
      UpdateExpression: "SET outputs = :outputs, updatedAt = :now",
      ExpressionAttributeValues: { ":outputs": outputs, ":now": new Date().toISOString() },
    }),
  );

  return { status: "completed", sourceLanguage, reason: "", outputs };
}

/** Keeps a subtitle that is already in the target language, and translates the others. */
async function localize(cues: Cue[], target: string, sourceLanguage: string): Promise<Cue[]> {
  const localized: Cue[] = [];
  for (const cue of cues) {
    const source = baseLanguage(cue.language) ?? baseLanguage(sourceLanguage) ?? "de";
    if (source === target) {
      localized.push(cue);
      continue;
    }
    localized.push({ ...cue, text: await translateCue(cue.text, source, target) });
  }
  return localized;
}

/**
 * Translates one subtitle and asks Translate to keep the result short, so it still fits on screen.
 * If that language pair cannot do a short translation, it tries again with the normal setting.
 */
async function translateCue(text: string, source: string, target: string): Promise<string> {
  try {
    const result = await translate.send(
      new TranslateTextCommand({
        Text: text,
        SourceLanguageCode: source,
        TargetLanguageCode: target,
        Settings: { Brevity: "ON" },
      }),
    );
    return result.TranslatedText ?? text;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (!name.includes("Validation") && !name.includes("Unsupported")) {
      throw error;
    }
    const result = await translate.send(
      new TranslateTextCommand({
        Text: text,
        SourceLanguageCode: source,
        TargetLanguageCode: target,
      }),
    );
    return result.TranslatedText ?? text;
  }
}
