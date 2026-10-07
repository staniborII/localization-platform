/** Checks that a rejected upload becomes the sentence shown on the page. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reasonFromUploadBody } from "./upload-result";

describe("reasonFromUploadBody", () => {
  it("uses a plain sentence for a checksum mismatch", () => {
    const body = "<Error><Code>BadDigest</Code><Message>The checksum did not match.</Message></Error>";
    assert.equal(reasonFromUploadBody(400, body), "The file did not match the checksum sent with it.");
  });

  it("keeps an unknown S3 message and its code", () => {
    const body = "<Error><Code>SlowDown</Code><Message>Please reduce your request rate.</Message></Error>";
    assert.equal(reasonFromUploadBody(503, body), "Please reduce your request rate. (SlowDown)");
  });

  it("names the status when the body has no error", () => {
    assert.equal(reasonFromUploadBody(403, "forbidden"), "The video upload was rejected (403).");
  });
});
