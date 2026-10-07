/**
 * Writes one WebVTT file and one SRT file from the same subtitles.
 * A cue is one subtitle. Numbers start at 1. Speaker labels stay anonymous.
 */

import { wrapCue, type Cue } from "./cues";

export interface SubtitleFiles {
  vtt: string;
  srt: string;
}

/** Formats a cue time. WebVTT uses a dot before the milliseconds. SRT uses a comma. */
function stamp(seconds: number, separator: "." | ","): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const pad = (value: number, width = 2) => value.toString().padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(millis, 3)}`;
}

/** Wraps the cue text. The speaker prefix is added later so it does not change the wrap. */
function linesFor(cue: Cue, maxChars: number, maxLines: number): string[] {
  const lines = wrapCue(cue.text, maxChars, maxLines);
  if (!cue.speaker || lines.length === 0) {
    return lines;
  }
  return lines;
}

/** Renders the cues as WebVTT and SRT. */
export function formatSubtitles(cues: Cue[], maxChars: number, maxLines: number): SubtitleFiles {
  const vtt: string[] = ["WEBVTT", ""];
  const srt: string[] = [];
  let index = 1;
  for (const cue of cues) {
    const lines = linesFor(cue, maxChars, maxLines);
    if (lines.length === 0) {
      continue;
    }
    const vttLines = cue.speaker ? [`<v ${cue.speaker}>${lines[0]}`, ...lines.slice(1)] : lines;
    const srtLines = cue.speaker ? [`[${cue.speaker}] ${lines[0]}`, ...lines.slice(1)] : lines;
    vtt.push(String(index), `${stamp(cue.start, ".")} --> ${stamp(cue.end, ".")}`, ...vttLines, "");
    srt.push(String(index), `${stamp(cue.start, ",")} --> ${stamp(cue.end, ",")}`, ...srtLines, "");
    index += 1;
  }
  return { vtt: `${vtt.join("\n")}\n`, srt: `${srt.join("\n")}\n` };
}
