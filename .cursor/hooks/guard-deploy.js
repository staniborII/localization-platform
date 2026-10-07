/**
 * Asks before a deploy, a destroy, or a mutating AWS CLI call.
 * A deploy is blocked until cdk synth in infra/ succeeds.
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { readStdin, respond } = require("./read-stdin");

const DEPLOY = /\bcdk\s+deploy\b/;
const DESTROY = /\bcdk\s+destroy\b/;
const MUTATING_AWS = /\baws\s+[^\n]*\b(delete|terminate|remove|put-|create-|update-|stop-|start-)/i;
const INFRA = path.join(__dirname, "..", "..", "infra");
const SYNTH_TIMEOUT_MS = 240000;

/** Builds the CloudFormation template. Throws when synth fails or runs out of time. */
function synth() {
  execFileSync("npx cdk synth", {
    cwd: INFRA,
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
    timeout: SYNTH_TIMEOUT_MS,
    windowsHide: true,
  });
}

/** Keeps the tail of a synth failure so the agent can see the error. */
function synthError(error) {
  const stderr = error && error.stderr ? String(error.stderr) : "";
  const stdout = error && error.stdout ? String(error.stdout) : "";
  const message = error instanceof Error ? error.message : "cdk synth failed";
  return (stderr || stdout || message).trim().slice(-4000);
}

readStdin()
  .then((input) => {
    const command = input.command || "";
    if (DEPLOY.test(command)) {
      try {
        synth();
      } catch (error) {
        respond({
          permission: "deny",
          user_message: "cdk synth failed, so the deploy was blocked.",
          agent_message: `cdk synth failed in infra/. Fix the template before deploying.\n${synthError(error)}`,
        });
        return;
      }
      respond({
        permission: "ask",
        user_message: "cdk synth succeeded. Confirm this deploy before it changes AWS.",
        agent_message: "cdk synth succeeded. A hook asked for approval before cdk deploy.",
      });
      return;
    }
    if (DESTROY.test(command) || MUTATING_AWS.test(command)) {
      respond({
        permission: "ask",
        user_message: "This command changes AWS resources. Confirm it before continuing.",
        agent_message: "A hook asked for approval before a destroy or mutating AWS call.",
      });
      return;
    }
    respond({ permission: "allow" });
  })
  .catch(() => {
    respond({ permission: "allow" });
  });
