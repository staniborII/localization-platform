# Video localization

Turns speech in an MP4 video into English, German, and Spanish subtitle files. The video file is not rewritten. `LocalizationStack` deploys the buckets, the workflow, the alarms, and the web client from a laptop.

## Docs

| | |
|---|---|
| [How one video becomes subtitles](docs/understanding-the-pipeline.md) | The path of one MP4, then cost and trade-offs |
| [Architecture](docs/explanation/architecture.md) | The flow from the web client to the consumer queue |
| [Workflow](docs/explanation/workflow.md) | One video, from upload to subtitle files |
| [Decisions](docs/explanation/architecture-decision-records/0001-storage.md) | Storage, orchestration, speech, the web client, and events |
| [Trade-offs](docs/explanation/trade-offs.md) | What this version leaves out, and why |
| [Challenge](docs/explanation/challenge.md) | What the case study asks for |
| [Configuration](docs/reference/configuration.md) | Stage files and environment variables |
| [Synth and deploy](docs/how-to/synth-and-deploy.md) | Check and deploy the infrastructure |
| [Run the client](docs/how-to/run-the-client.md) | Build and open the web client |
| [Presentation](docs/presentation.md) | The same story, for the room |
| [Agent tooling](docs/reference/agent-tooling.md) | Rules, skills, and hooks that guide an agent in this repo |

The folder map is in [repository layout](docs/reference/repository-layout.md). The full index is [docs/README.md](docs/README.md).
