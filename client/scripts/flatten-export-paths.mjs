/**
 * Moves Windows static-export page data onto the flat names the browser requests.
 * A Windows build saves upload/__next.upload/__PAGE__.txt. The browser asks for upload/__next.upload.__PAGE__.txt.
 */

import { readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");

/** Walks the export and flattens each __next.* folder that holds a page file. */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith("__next.")) {
      await flatten(dir, entry.name, full);
      continue;
    }
    await walk(full);
  }
}

/** Moves __PAGE__.txt up next to its __next.* folder, then removes the folder. */
async function flatten(parent, name, full) {
  const page = path.join(full, "__PAGE__.txt");
  try {
    const info = await stat(page);
    if (!info.isFile()) {
      return;
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  const dest = path.join(parent, `${name}.__PAGE__.txt`);
  await rm(dest, { force: true });
  await rename(page, dest);
  await rm(full, { recursive: true, force: true });
}

/** Flattens client/out when that folder exists. A missing export is left for the build to create. */
async function main() {
  try {
    await stat(outDir);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  await walk(outDir);
}

await main();
