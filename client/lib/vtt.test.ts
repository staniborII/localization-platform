/** Checks that a subtitle file becomes the cue list shown under the video. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSrt, parseVtt } from "./vtt";

describe("parseVtt", () => {
  it("reads cue times, text, and the anonymous speaker", () => {
    const cues = parseVtt(`WEBVTT

1
00:00:01.200 --> 00:00:04.000
<v spk_0>Good evening

2
00:00:04.500 --> 00:00:06.000
from the stadium
`);
    assert.equal(cues.length, 2);
    assert.equal(cues[0]?.speaker, "spk_0");
    assert.equal(cues[0]?.text, "Good evening");
    assert.equal(cues[0]?.startSeconds, 1.2);
    assert.equal(cues[1]?.text, "from the stadium");
    assert.equal(cues[1]?.speaker, undefined);
  });
});

describe("parseSrt", () => {
  it("reads comma timestamps and the speaker in brackets", () => {
    const cues = parseSrt(`1
00:00:01,200 --> 00:00:04,000
[spk_0] Good evening

2
00:00:04,500 --> 00:00:06,000
from the stadium
`);
    assert.equal(cues.length, 2);
    assert.equal(cues[0]?.speaker, "spk_0");
    assert.equal(cues[0]?.text, "Good evening");
    assert.equal(cues[0]?.startSeconds, 1.2);
    assert.equal(cues[1]?.text, "from the stadium");
  });
});
