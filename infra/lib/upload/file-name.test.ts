/** Checks that the profile is the word after the last underscore, and that other names are rejected. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanedFileName, profileFromFileName } from "./file-name";

describe("file name", () => {
  it("reads the profile from the word after the last underscore", () => {
    assert.equal(profileFromFileName("sample_01_highlights.mp4"), "highlights");
    assert.equal(profileFromFileName("sample_02_interview.mp4"), "interview");
    assert.equal(profileFromFileName("sample_03_feature.mp4"), "feature");
    assert.equal(profileFromFileName("SAMPLE_02_INTERVIEW.MP4"), "interview");
    assert.equal(profileFromFileName("bvb_leverkusen_highlights.mp4"), "highlights");
    assert.equal(profileFromFileName(String.raw`C:\clips\sample_02_interview.mp4`), "interview");
  });

  it("rejects a name that is not an mp4 or has no profile word", () => {
    assert.equal(profileFromFileName("notes.mp4"), undefined);
    assert.equal(profileFromFileName("sample_02.mp4"), undefined);
    assert.equal(profileFromFileName("sample_02_interview.mov"), undefined);
    assert.equal(profileFromFileName("sample_.mp4"), undefined);
    assert.equal(profileFromFileName(""), undefined);
    assert.equal(cleanedFileName("../notes.txt"), undefined);
  });
});
