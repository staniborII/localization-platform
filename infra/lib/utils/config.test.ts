/** Checks that stage loading rejects a bad stage and a missing account. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "./config";

/** Writes a minimal stage file under a temporary infra root. */
function writeStage(root: string, stage: string): void {
  const dir = path.join(root, "config");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `config.${stage}.yml`),
    [
      "service: bundesliga",
      "name: localization",
      "owner: bundesliga",
      "removalPolicy: destroy",
      "budgetUsd: 25",
      "features:",
      "  deployCustomDomain: false",
      "  audioNormalization: false",
      "  burnInCaptions: false",
      "  realtimeStatus: poll",
      "languages:",
      "  candidates: [en-US, de-DE]",
      "  outputs: [en, de, es]",
      "profiles:",
      "  highlights:",
      "    speakerLabels: false",
      "  interview:",
      "    speakerLabels: true",
      "    maxSpeakers: 2",
      "defaultProfile: highlights",
      "runtime:",
      "  cueMaxChars: 42",
      "  cueMaxLines: 2",
      "  pollIntervalSeconds: 2",
      "  languageConfidenceMin: 0.8",
      "",
    ].join("\n"),
  );
}

describe("loadConfig", () => {
  it("rejects a stage other than dev or prod", () => {
    assert.throws(() => loadConfig({ STAGE: "staging", AWS_ACCOUNT_ID: "000000000000", AWS_REGION: "eu-central-1" }), /STAGE/);
  });

  it("rejects a missing account", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loc-"));
    writeStage(root, "dev");
    assert.throws(() => loadConfig({ STAGE: "dev", AWS_REGION: "eu-central-1" }, root), /AWS_ACCOUNT_ID/);
  });

  it("loads dev from the environment and the stage file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loc-"));
    writeStage(root, "dev");
    const loaded = loadConfig({ STAGE: "dev", AWS_ACCOUNT_ID: "123456789012", AWS_REGION: "eu-central-1" }, root);
    assert.equal(loaded.stage, "dev");
    assert.equal(loaded.account, "123456789012");
    assert.equal(loaded.region, "eu-central-1");
    assert.equal(loaded.config.languages.outputs.join(","), "en,de,es");
  });
});
