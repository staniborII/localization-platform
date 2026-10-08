/** Checks that a missing or outdated site export is rebuilt, and a current one is left alone. */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { siteExportIsStale } from "./site-export";

/** Writes one file and sets when it was last changed. */
function touch(file: string, mtimeMs: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "x");
  const time = new Date(mtimeMs);
  utimesSync(file, time, time);
}

describe("site export", () => {
  it("asks for a build when the export is missing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "site-export-"));
    try {
      touch(path.join(root, "app", "page.tsx"), 1_000);
      assert.equal(siteExportIsStale(root), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("asks for a build when a page is newer than the export", () => {
    const root = mkdtempSync(path.join(tmpdir(), "site-export-"));
    try {
      touch(path.join(root, "out", "index.html"), 1_000);
      touch(path.join(root, "components", "ui", "button.tsx"), 2_000);
      assert.equal(siteExportIsStale(root), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("asks for a build when a client config file is newer than the export", () => {
    const root = mkdtempSync(path.join(tmpdir(), "site-export-"));
    try {
      touch(path.join(root, "out", "index.html"), 1_000);
      touch(path.join(root, "package.json"), 2_000);
      assert.equal(siteExportIsStale(root), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves a current export alone", () => {
    const root = mkdtempSync(path.join(tmpdir(), "site-export-"));
    try {
      touch(path.join(root, "app", "page.tsx"), 1_000);
      touch(path.join(root, "out", "index.html"), 2_000);
      touch(path.join(root, "node_modules", "next", "package.json"), 3_000);
      assert.equal(siteExportIsStale(root), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
