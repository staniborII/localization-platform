/** Checks that a polled job keeps the video link it already has. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { holdJobMedia, presignExpired, presignExpiry } from "./presign";

describe("presign", () => {
  it("reads the signing time and treats a link as expired after that window", () => {
    const url = "https://example.invalid/video.mp4?X-Amz-Date=20261006T220000Z&X-Amz-Expires=900";
    assert.equal(presignExpiry(url), Date.UTC(2026, 9, 6, 22, 15, 0));
    assert.equal(presignExpired(url, Date.UTC(2026, 9, 6, 22, 10, 0)), false);
    assert.equal(presignExpired(url, Date.UTC(2026, 9, 6, 22, 15, 0)), true);
  });

  it("keeps the first video link when a later poll signs a new one", () => {
    const first = { videoUrl: "https://example.invalid/first", outputs: [{ vttUrl: "https://example.invalid/en.vtt" }] };
    const polled = { videoUrl: "https://example.invalid/second", outputs: [{ vttUrl: "https://example.invalid/en-new.vtt" }] };
    assert.equal(holdJobMedia(first, polled).videoUrl, first.videoUrl);
    assert.equal(holdJobMedia(first, polled).outputs[0]?.vttUrl, "https://example.invalid/en.vtt");
  });

  it("takes subtitle links the first time they appear", () => {
    const waiting = { videoUrl: "https://example.invalid/first", outputs: [] as { vttUrl?: string }[] };
    const ready = { videoUrl: "https://example.invalid/second", outputs: [{ vttUrl: "https://example.invalid/en.vtt" }] };
    const held = holdJobMedia(waiting, ready);
    assert.equal(held.videoUrl, waiting.videoUrl);
    assert.equal(held.outputs[0]?.vttUrl, "https://example.invalid/en.vtt");
  });
});
