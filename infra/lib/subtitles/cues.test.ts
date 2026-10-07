/** Checks cue splits, subtitle numbering, and how a transcript becomes words. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupCues } from "./cues";
import { formatSubtitles } from "./generate-subtitle-files";
import { wordsFromTranscript } from "./transcript";

describe("cues", () => {
  it("splits on a speaker change and numbers subtitle files from 1", () => {
    const cues = groupCues(
      [
        { text: "Hello", start: 0, end: 0.4, speaker: "spk_0", language: "en-US" },
        { text: "there", start: 0.5, end: 0.9, speaker: "spk_0", language: "en-US" },
        { text: "Thanks", start: 1, end: 1.4, speaker: "spk_1", language: "en-US" },
      ],
      42,
      2,
    );
    assert.equal(cues.length, 2);
    assert.equal(cues[0]?.speaker, "spk_0");
    assert.equal(cues[1]?.text, "Thanks");
    const files = formatSubtitles(cues, 42, 2);
    assert.match(files.vtt, /^WEBVTT\n\n1\n/);
    assert.match(files.srt, /^1\n/);
    assert.match(files.vtt, /\n2\n/);
    assert.match(files.vtt, /<v spk_0>Hello there/);
  });

  it("keeps each cue inside the character budget", () => {
    const words = Array.from({ length: 30 }, (_, index) => ({
      text: "word",
      start: index * 0.3,
      end: index * 0.3 + 0.2,
      language: "en-US",
    }));
    const cues = groupCues(words, 42, 2);
    assert.ok(cues.length > 1);
    for (const cue of cues) {
      assert.ok(cue.text.length <= 42 * 2);
    }
  });
});

describe("transcript", () => {
  it("joins punctuation and keeps the speaker", () => {
    const parsed = wordsFromTranscript({
      results: {
        language_code: "en-US",
        language_identification: [{ code: "en-US", score: "0.93" }],
        speaker_labels: {
          speakers: 1,
          segments: [{ speaker_label: "spk_0", start_time: "0.0", end_time: "1.0" }],
        },
        items: [
          { type: "pronunciation", start_time: "0.1", end_time: "0.4", alternatives: [{ content: "Goal" }] },
          { type: "punctuation", alternatives: [{ content: "." }] },
        ],
      },
    });
    assert.equal(parsed.words.length, 1);
    assert.equal(parsed.words[0]?.text, "Goal.");
    assert.equal(parsed.words[0]?.speaker, "spk_0");
    assert.equal(parsed.languageCode, "en-US");
    assert.equal(parsed.confidence, 0.93);
  });
});
