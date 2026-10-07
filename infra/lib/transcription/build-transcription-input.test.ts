/** Checks that the three content profiles select the three transcription modes. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transcriptionMode } from "./build-transcription-input";

describe("profiles", () => {
  it("maps the three content shapes", () => {
    assert.equal(transcriptionMode({ speakerLabels: false }), "highlights");
    assert.equal(transcriptionMode({ speakerLabels: true, maxSpeakers: 2 }), "speakers");
    assert.equal(transcriptionMode({ speakerLabels: true, maxSpeakers: 6, multiLanguage: true }), "multi");
  });
});
