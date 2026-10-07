# Repository layout

```text
.
├── client/                 Next.js static export
│   ├── app/                Routes: upload, jobs, gallery, failures, job
│   ├── AGENTS.md           Points agents at the bundled Next.js docs
│   └── next.config.ts      output: "export"
├── infra/
│   ├── bin/app.ts          Loads .env and creates LocalizationStack
│   ├── config/             config.dev.yml, config.prod.yml
│   ├── lib/lambda/         Six handlers, plus dynamodb, required-variable, and request-response
│   ├── lib/upload/         File-name check
│   ├── lib/stable-job-id/  Stable id for one video, profile, and language list
│   ├── lib/transcription/  Transcription input and the Step Functions state machine
│   ├── lib/subtitles/      Cue grouping, transcript, subtitle files, transcript location
│   ├── lib/platform/       Event bus, topic, and consumer queue
│   ├── lib/stacks/         LocalizationStack and Data, pipeline, monitoring, web client
│   ├── lib/shared/         Lambda construct and runtime config
│   └── lib/utils/          Names and the stage-config loader
├── docs/
│   ├── understanding-the-pipeline.md  One MP4, from the web client to the last queue
│   ├── explanation/        Why, trade-offs, workflow, and ADRs
│   ├── reference/          Settings, resources, events, and layout
│   └── how-to/             Synth, deploy, and the client
├── .agents/skills/         Next.js next-dev-loop skill
├── .cursor/                Rules, skills, hooks, and the Next.js devtools MCP
└── .cursorignore           Keeps .env out of the agent file tools
```

`infra/bin/app.ts` creates `LocalizationStack`. That stack wires the other four. Physical names come from `infra/lib/utils/index.ts`.

Dependency order is Data, then the pipeline, then monitoring and the web client. The web client also reads the buckets and the job table from Data. The resources in each stack are listed in [Resources](resources.md).
