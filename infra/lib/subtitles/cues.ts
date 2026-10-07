/**
 * Groups spoken words into subtitles.
 * A cue is one subtitle: the words shown between a start time and an end time.
 * A new one starts after a pause, a new speaker, a language change, or a line that would be too long.
 */

export interface Word {
  text: string;
  start: number;
  end: number;
  speaker?: string;
  language?: string;
}

export interface Cue {
  start: number;
  end: number;
  speaker?: string;
  language?: string;
  text: string;
}

const PAUSE_SECONDS = 0.8;
const CHARS_PER_SECOND = 21;

/** Splits words into subtitles short enough to read on screen. */
export function groupCues(words: Word[], maxChars: number, maxLines: number): Cue[] {
  const cues: Cue[] = [];
  let current: Word[] = [];
  const textOf = (list: Word[]) => list.map((word) => word.text).join(" ");

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const first = current[0];
    const last = current[current.length - 1];
    cues.push({
      start: first.start,
      end: Math.max(last.end, first.start + 0.2),
      speaker: first.speaker,
      language: first.language,
      text: textOf(current),
    });
    current = [];
  };

  for (const word of words) {
    if (current.length > 0) {
      const previous = current[current.length - 1];
      const first = current[0];
      const joined = textOf([...current, word]);
      const gap = word.start - previous.end;
      const speakerChanged = Boolean(previous.speaker && word.speaker && previous.speaker !== word.speaker);
      const languageChanged = Boolean(previous.language && word.language && previous.language !== word.language);
      const tooLong = joined.length > maxChars * maxLines;
      const seconds = Math.max(word.end - first.start, 0.4);
      const tooDense = joined.length / seconds > CHARS_PER_SECOND;
      if (gap > PAUSE_SECONDS || speakerChanged || languageChanged || tooLong || tooDense) {
        flush();
      }
    }
    current.push(word);
  }
  flush();
  return cues;
}

/** Breaks one subtitle into at most maxLines lines of maxChars characters. */
export function wrapCue(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    lines.push(line);
  }
  if (lines.length <= maxLines) {
    return lines;
  }
  const kept = lines.slice(0, maxLines - 1);
  kept.push(lines.slice(maxLines - 1).join(" "));
  return kept;
}
