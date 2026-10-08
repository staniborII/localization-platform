/**
 * Builds the web client pages into client/out before synth packages that folder.
 * The export is the HTML and scripts CloudFront serves.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const CLIENT_ROOT = path.join(__dirname, "../../../client");

const SOURCE_DIRS = ["app", "components", "lib", "public", "scripts"];
const SOURCE_FILES = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "postcss.config.mjs",
  "components.json",
];

/** True when client/out is missing or a page source is newer than the last export. */
export function siteExportIsStale(clientRoot = CLIENT_ROOT): boolean {
  let builtAt = 0;
  try {
    builtAt = statSync(path.join(clientRoot, "out", "index.html")).mtimeMs;
  } catch {
    return true;
  }
  return newestSourceMtime(clientRoot) > builtAt;
}

/** Builds the site when the export is stale, then returns the out folder. */
export function ensureSiteExport(): string {
  const out = path.join(CLIENT_ROOT, "out");
  if (!siteExportIsStale()) {
    console.log("Web client export is current. Skipping the site build.");
    return out;
  }
  console.log("Web client sources changed. Building the static export.");
  execFileSync("npm", ["run", "build"], {
    cwd: CLIENT_ROOT,
    shell: true,
    stdio: "inherit",
  });
  return out;
}

/** The latest change time among the files the site build reads. */
function newestSourceMtime(clientRoot: string): number {
  let newest = 0;
  for (const dir of SOURCE_DIRS) {
    newest = Math.max(newest, newestIn(path.join(clientRoot, dir)));
  }
  for (const file of SOURCE_FILES) {
    newest = Math.max(newest, mtimeOf(path.join(clientRoot, file)));
  }
  return newest;
}

/** The latest change time under one folder. A missing folder counts as unchanged. */
function newestIn(dir: string): number {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let newest = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestIn(full) : mtimeOf(full));
  }
  return newest;
}

/** The change time of one file, or zero when the file is missing. */
function mtimeOf(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
