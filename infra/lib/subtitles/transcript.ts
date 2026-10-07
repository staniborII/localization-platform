/**
 * Reads words, the detected language, and the confidence score out of a Transcribe JSON file.
 */

import type { Word } from "./cues";

export interface ParsedTranscript {
  words: Word[];
  languageCode?: string;
  confidence?: number;
  speakerCount?: number;
}

interface TranscriptItem {
  type?: string;
  start_time?: string;
  end_time?: string;
  language_code?: string;
  alternatives?: { content?: string }[];
}

interface SpeakerSegment {
  speaker_label?: string;
  start_time?: string;
  end_time?: string;
}

interface AudioSegment {
  start_time?: string;
  end_time?: string;
  language_code?: string;
}

/** Returns the value when it is a plain object. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/** Finds the anonymous speaker label that covers this word. */
function speakerAt(segments: SpeakerSegment[], start: number): string | undefined {
  const match = segments.find((segment) => {
    const from = Number(segment.start_time);
    const to = Number(segment.end_time);
    return start >= from && start < to;
  });
  return match?.speaker_label;
}

/** Uses the word language, or the audio segment that covers this time. */
function languageAt(segments: AudioSegment[], start: number, itemLanguage: string | undefined): string | undefined {
  if (itemLanguage) {
    return itemLanguage;
  }
  const match = segments.find((segment) => {
    const from = Number(segment.start_time);
    const to = Number(segment.end_time);
    return start >= from && start < to;
  });
  return match?.language_code;
}

/** Joins punctuation onto the previous word and keeps speaker and language on each word. */
export function wordsFromTranscript(payload: unknown): ParsedTranscript {
  const root = asRecord(payload);
  const results = asRecord(root?.results);
  if (!results) {
    return { words: [] };
  }

  const items = Array.isArray(results.items) ? (results.items as TranscriptItem[]) : [];
  const speakerLabels = asRecord(results.speaker_labels);
  const speakerSegments = Array.isArray(speakerLabels?.segments) ? (speakerLabels.segments as SpeakerSegment[]) : [];
  const audioSegments = Array.isArray(results.audio_segments) ? (results.audio_segments as AudioSegment[]) : [];
  const words: Word[] = [];

  for (const item of items) {
    const content = item.alternatives?.[0]?.content?.trim();
    if (!content) {
      continue;
    }
    if (item.type === "punctuation") {
      const previous = words[words.length - 1];
      if (previous) {
        previous.text += content;
      }
      continue;
    }
    const start = Number(item.start_time ?? 0);
    const end = Number(item.end_time ?? start);
    words.push({
      text: content,
      start,
      end: end > start ? end : start + 0.2,
      speaker: speakerAt(speakerSegments, start),
      language: languageAt(audioSegments, start, item.language_code),
    });
  }

  const identification = Array.isArray(results.language_identification)
    ? (results.language_identification as { code?: string; score?: string | number }[])
    : [];
  const top = identification[0];
  const score = top?.score === undefined ? undefined : Number(top.score);
  const speakerCount = speakerLabels?.speakers === undefined ? undefined : Number(speakerLabels.speakers);

  return {
    words,
    languageCode: (results.language_code as string | undefined) ?? top?.code,
    confidence: score === undefined || Number.isNaN(score) ? undefined : score,
    speakerCount: speakerCount === undefined || Number.isNaN(speakerCount) ? undefined : speakerCount,
  };
}

/** Base language codes found on the words, such as en and de. Order does not matter to the caller. */
export function spokenLanguages(words: { language?: string }[]): string[] {
  const found = new Set<string>();
  for (const word of words) {
    const base = word.language?.toLowerCase().split("-")[0];
    if (base && /^[a-z]{2}$/.test(base)) {
      found.add(base);
    }
  }
  return [...found].sort();
}

/** Lowest identification score, used when a file mixes languages. */
export function lowestConfidence(payload: unknown): number | undefined {
  const results = asRecord(asRecord(payload)?.results);
  const identification = Array.isArray(results?.language_identification)
    ? (results.language_identification as { score?: string | number }[])
    : [];
  const scores = identification
    .map((entry) => (entry.score === undefined ? undefined : Number(entry.score)))
    .filter((score): score is number => score !== undefined && !Number.isNaN(score));
  if (scores.length === 0) {
    return undefined;
  }
  return Math.min(...scores);
}
