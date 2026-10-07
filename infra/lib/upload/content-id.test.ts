/** Checks the duplicate key and the two size limits the upload path shares. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SINGLE_PUT_BYTES, TRANSCRIBE_MAX_BYTES, contentKey, sha256Base64ToHex, sha256HexToBase64 } from "./content-id";

const DIGEST = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("content identity", () => {
  it("uses the file hash, size, profile, and languages", () => {
    const first = contentKey({ sha256: DIGEST, size: 10, profile: "interview", outputs: ["es", "en", "de"] });
    const second = contentKey({ sha256: DIGEST, size: 10, profile: "interview", outputs: ["de", "en", "es"] });
    const otherSize = contentKey({ sha256: DIGEST, size: 11, profile: "interview", outputs: ["de", "en", "es"] });
    assert.equal(first, second);
    assert.notEqual(first, otherSize);
    assert.equal(first.length, 64);
  });

  it("keeps the single-part and Transcribe ceilings in binary gigabytes", () => {
    assert.equal(MAX_SINGLE_PUT_BYTES, 5 * 1024 * 1024 * 1024);
    assert.equal(TRANSCRIBE_MAX_BYTES, 2 * 1024 * 1024 * 1024);
  });

  it("converts a SHA-256 digest between hex and base64", () => {
    assert.equal(sha256Base64ToHex(sha256HexToBase64(DIGEST)), DIGEST);
    assert.equal(sha256Base64ToHex("aaaa"), undefined);
  });
});
