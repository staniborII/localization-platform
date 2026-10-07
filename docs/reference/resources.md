# Resources

Physical names follow `{service}-{name}-{purpose}-{stage}` from `resourceName()`. The stage files set `service` and `name` to `bundesliga` and `localization`.

## Data

| Purpose | Resource |
|---|---|
| `video-upload-bucket` | Private bucket. Uploads land at `video-upload/{profile}/{id}.mp4`. EventBridge is enabled. |
| `transcript-subtitle-bucket` | Private bucket. Transcripts at `transcripts/{transcriptionJobName}.json`. Audio extracted for a file over 2 GiB at `audio/{jobId}.mp3`. Subtitles at `subtitles/{jobId}/{lang}.vtt` and `.srt`. |
| `media-access-logs` | Access logs for the media buckets and the site bucket. |
| `job-table` | DynamoDB table. Partition key `jobId`, one item for the detail page. Index `recent` groups every job under `listPk = job`, sorted by `updatedAt`, for the jobs page. Index `status` groups by `status`, sorted by `updatedAt`, for the gallery (`completed`) and the failures page (`failed`). Each list returns at most 50. |

Buckets block public access, require TLS, and use SSE-S3. Dev destroys them with the stack. Prod retains them and turns on deletion protection for the table.

## Pipeline

| Purpose | Resource |
|---|---|
| `workflow` | Standard state machine. |
| `job-outcome-event-bus` | Application event bus. |
| `job-outcome-fanout-topic` | SNS topic. No email subscription. |
| `job-outcome-inbox` | SQS queue subscribed to the topic. |
| `upload-event-dead-letter`, `transcribe-event-dead-letter`, `job-outcome-fanout-dead-letter`, `job-outcome-inbox-dead-letter` | Dead-letter queues for upload events, Transcribe events, fan-out, and the inbox. |
| `store-transcribe-task-token`, `write-translated-subtitles`, `transcribe-finished-callback`, `start-workflow-on-upload` | Pipeline functions. |

Functions receive the runtime slice of the stage file as the `CONFIG` environment variable at deploy time.

## Web client

| Purpose | Resource |
|---|---|
| `web-client-bucket` | Private bucket for the static export. |
| `presign`, `status` | Function URLs behind CloudFront, IAM auth, origin access control. |

CloudFront behaviors: `/` is the site, `/api/uploads` is presign, `/api/jobs*` is status. The stack output `ConsoleUrl` is the hostname.

## Monitoring

| Purpose | Resource |
|---|---|
| `alarms` | SNS topic for alarm and budget notifications. No email subscription. |
| `workflow-health-dashboard` | CloudWatch dashboard. Job outcomes, execution crashes, and dead-letter depth. The numbers are the total for the selected time range. |
| `monthly-cost-budget` | Monthly cost budget. The amount is `budgetUsd` in the stage file. |
| `workflow-failed` | Alarm when a workflow execution crashes. |
| `job-failed` | Alarm when a job is stored as failed. The execution can still succeed. |
| one alarm per dead-letter queue | Alarm when that queue has a message. The alarm uses the same purpose as its queue. |

The inbox queue is not alarmed when it has messages. A partner may not be attached yet.
