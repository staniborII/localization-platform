/** Checks that back links return to the list the page was opened from. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backToJob, backToList, jobHref, sectionFrom, sectionFromPath, watchHref } from "./navigation";

describe("navigation", () => {
  it("keeps gallery on the job and subtitle addresses", () => {
    assert.equal(sectionFrom("gallery"), "gallery");
    assert.equal(sectionFrom("home"), undefined);
    assert.equal(sectionFromPath("/gallery.html"), "gallery");
    assert.equal(jobHref("abc", "gallery"), "/job?id=abc&from=gallery");
    assert.equal(watchHref("abc", "de", "srt", "gallery"), "/watch?id=abc&lang=de&format=srt&from=gallery");
    assert.deepEqual(backToList("gallery"), { href: "/gallery", label: "Back to gallery" });
    assert.deepEqual(backToJob("abc", "gallery"), { href: "/job?id=abc&from=gallery", label: "Back to the job" });
  });

  it("returns to jobs when the page was opened directly", () => {
    assert.deepEqual(backToList(undefined), { href: "/jobs", label: "Back to jobs" });
  });
});