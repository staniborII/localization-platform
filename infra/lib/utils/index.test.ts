/** Checks physical names and construct ids. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resourceName, stagified } from "./index";

const parts = { service: "bundesliga", name: "localization" };

describe("resourceName", () => {
  it("builds a stagified lowercase name", () => {
    assert.equal(resourceName(parts, "video-upload", "dev"), "bundesliga-localization-video-upload-dev");
  });

  it("splits a title case purpose into hyphens", () => {
    assert.equal(
      resourceName(parts, "WorkflowHealthDashboard", "dev"),
      "bundesliga-localization-workflow-health-dashboard-dev",
    );
  });

  it("strips characters that S3 rejects", () => {
    assert.equal(
      resourceName({ service: "Bundesliga", name: "Localization_App" }, "video-upload", "dev"),
      "bundesliga-localization-app-video-upload-dev",
    );
  });

  it("trims to the S3 length limit without a trailing hyphen", () => {
    const long = resourceName(
      { service: "bundesliga", name: "localization" },
      "a-very-long-purpose-name-that-exceeds-the-limit",
      "prod",
    );
    assert.ok(long.length <= 63);
    assert.equal(long.endsWith("-"), false);
    assert.match(long, /^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  });
});

describe("stagified", () => {
  it("appends the stage in title case", () => {
    assert.equal(stagified("Workflow", "dev"), "WorkflowDev");
    assert.equal(stagified("Workflow", "prod"), "WorkflowProd");
  });

  it("joins the stage with a hyphen when title case is off", () => {
    assert.equal(stagified("workflow", "dev", false), "workflow-dev");
  });
});
