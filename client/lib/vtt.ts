/**
 * Reads a subtitle file into cues the watch page can list.
 * A cue is one subtitle: the words shown between a start time and an end time.
 */

export interface SubtitleCue {
  start: string;
  end: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  speaker?: string;
}

/** Turns a WebVTT timestamp into seconds from the start of the video. */
function toSeconds(stamp: string): number {
  const [hours, minutes, rest] = stamp.split(":");
  const [seconds, millis] = rest.split(".");
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000;
}

/** Pulls the speaker tag off the first line, as in `<v spk_0>text`. */
function spokenLine(line: string): { speaker?: string; text: string } {
  const voice = /^<v\s+([^>]+)>(.*)$/.exec(line);
  if (!voice) {
    return { text: line.replace(/<[^>]+>/g, "") };
  }
  return { speaker: voice[1], text: voice[2] };
}

/** Splits a WebVTT document into cues. Header and note blocks are skipped. */
export function parseVtt(source: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = source.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      continue;
    }
    const timing = /^(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/.exec(lines[timingIndex] ?? "");
    const body = lines.slice(timingIndex + 1);
    if (!timing || body.length === 0) {
      continue;
    }
    const first = spokenLine(body[0] ?? "");
    const rest = body.slice(1).map((line) => line.replace(/<[^>]+>/g, ""));
    const text = [first.text, ...rest].filter((line) => line.length > 0).join("\n");
    if (!text) {
      continue;
    }
    cues.push({
      start: timing[1] ?? "",
      end: timing[2] ?? "",
      startSeconds: toSeconds(timing[1] ?? "00:00:00.000"),
      endSeconds: toSeconds(timing[2] ?? "00:00:00.000"),
      text,
      ...(first.speaker ? { speaker: first.speaker } : {}),
    });
  }
  return cues;
}

/** Splits an SRT file into the same cues. SRT writes the milliseconds after a comma. */
export function parseSrt(source: string): SubtitleCue[] {
  const asVtt = source.replace(/\r\n/g, "\n").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return parseVtt(`WEBVTT\n\n${asVtt}`).map((cue) => {
    const speaker = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(cue.text);
    if (!speaker?.[1]) {
      return cue;
    }
    return { ...cue, speaker: speaker[1], text: speaker[2] ?? "" };
  });
}
