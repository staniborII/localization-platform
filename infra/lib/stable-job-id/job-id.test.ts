/** Checks that a job id is stable for the same object and can be read back from a transcription name. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jobId, jobIdFromTranscriptionName } from "./job-id";

describe("job id", () => {
  const base = {
    bucket: "video-upload-bucket",
    key: "video-upload/highlights/a.mp4",
    etag: "abc",
    profile: "highlights",
    outputs: ["es", "en", "de"],
  };

  it("ignores output order and changes when the object changes", () => {
    const first = jobId(base);
    assert.equal(first, jobId({ ...base, outputs: ["de", "en", "es"] }));
    assert.equal(first.length, 32);
    assert.notEqual(first, jobId({ ...base, etag: "other" }));
  });

  it("reads the job id from a rerun transcription name", () => {
    assert.equal(jobIdFromTranscriptionName(`${"a".repeat(32)}-f2`), "a".repeat(32));
    assert.equal(jobIdFromTranscriptionName("not-a-job"), undefined);
  });
});
