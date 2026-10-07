/** Checks the browser hasher against the platform SHA-256, including a hash that crosses a block boundary. */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { sha256Hex, sha256HexOfBlob, sha256HexOfString } from "../../client/lib/sha256";

describe("upload hash", () => {
  it("matches SHA-256 for an empty file, a known string, and a buffer past one block", async () => {
    assert.equal(sha256Hex(new Uint8Array()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(
      sha256Hex(new TextEncoder().encode("abc")),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assert.equal(sha256HexOfString("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const bytes = randomBytes(200);
    const expected = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256Hex(bytes), expected);
    assert.equal(await sha256HexOfBlob(new Blob([bytes])), expected);
  });
});
