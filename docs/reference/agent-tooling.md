# Agent tooling

Files that guide an agent working in this repository. They are not part of the deployed pipeline.

## Instructions

| File | What it tells the agent |
|---|---|
| `AGENTS.md` | Where infrastructure, the web client, and the decision records live. A pipeline resource needs an ADR first. |
| `client/AGENTS.md` | This Next.js app is a static export. Job and subtitle pages use query strings. The bundled Next.js docs are under `client/node_modules/next/dist/docs/`. |
| `client/CLAUDE.md` | Points at `client/AGENTS.md`. |

## Rules

`.cursor/rules/` holds the standing rules. Each file is one subject.

| Rule | What it covers |
|---|---|
| `challenge-scope.mdc` | This is the Localization case study. Design artifacts come first. No CI pipeline. Sample videos stay off git. |
| `adr-and-docs.mdc` | Docs stay in one Diátaxis type. An ADR has context, decision, alternatives, trade-off, cost, and failure behavior. |
| `cdk-stacks.mdc` | `LocalizationStack` creates Data, the pipeline, monitoring, and the web client. `cdk-nag` stays on. |
| `naming.mdc` | Stored names come from `resourceName()`. Construct ids come from `stagified()`. |
| `env-config.mdc` | `.env` holds the stage, profile, account, and region. Stage behavior lives in the YAML files. |
| `secrets.mdc` | Passwords, tokens, and access keys stay out of source and `.env`. The pipeline uses IAM. |
| `security.mdc` | One role per function. Actions and resource ARNs stay on the buckets, table, and state machine this app created. |
| `cost-guardrails.mdc` | Prefer serverless. One region. No VPC, NAT gateway, or provisioned concurrency unless an ADR accepts the charge. |
| `source-comments.mdc` | TypeScript files and functions start with a short comment in everyday words. |
| `nextjs-react-generalist-cursor-rules.mdc` | How to change the web client: read the existing code, then plan, then edit. |

## Skills

A skill is a longer procedure the agent follows for one kind of task.

| Skill | What it is for |
|---|---|
| `.cursor/skills/localization-pipeline/SKILL.md` | Languages, profiles, subtitle outputs, and the platform event contract. |
| `.cursor/skills/write-adr/SKILL.md` | The shape of one decision record. |
| `.cursor/skills/aws-service-check/SKILL.md` | Regional availability and the pricing unit before a service is chosen. |
| `.agents/skills/next-dev-loop/SKILL.md` | Check a Next.js change in a running `next dev` session. `skills-lock.json` records the installed copy. |

## Hooks

`.cursor/hooks.json` runs these scripts before an agent shell command.

| Script | What it does |
|---|---|
| `guard-deploy.js` | Before `cdk deploy`, runs `npx cdk synth` in `infra/`. A failed synth blocks the deploy. A successful synth still asks for confirmation. `cdk destroy` and a mutating AWS CLI call ask for confirmation and do not synth. The hook may run for up to five minutes. |
| `guard-secrets.js` | Blocks `git add` of `.env`, a credentials file, a private key, or an `.mp4`. |
| `read-stdin.js` | Shared helper. Reads the hook input and writes the JSON answer. |

## MCP

`.mcp.json` and `.cursor/mcp.json` start the Next.js devtools server (`next-devtools-mcp`) for the web client.

## Files the agent does not open

`.cursorignore` lists `.env`. The agent file tools cannot open it. `infra/.env.example` stays readable. A terminal command can still print `.env`.
