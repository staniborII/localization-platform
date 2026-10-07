# Architecture

The pipeline turns speech in an MP4 into English, German, and Spanish subtitle files. The video file is not rewritten. An MP4 over 2 GiB is the exception: MediaConvert writes an audio-only file, and Transcribe reads that. The uploaded MP4 is still what the web client plays. Everything is in `eu-central-1`. There is no VPC.

```mermaid
flowchart TD
  client[Web client]
  presign[presign-lambda]
  status[status-lambda]
  videoUpload[Video upload bucket]
  defaultBus[EventBridge default bus]
  starter[starter-lambda]
  table[Job table]

  subgraph machine [Step Functions state machine]
    direction TB
    mark[Mark running]
    size{MP4 over 2 GiB?}
    convert[MediaConvert]
    start[Start Transcribe]
    token[token-lambda]
    subtitles[subtitle-lambda]
    publish[Save status and publish]
    mark --> size
    size -->|yes| convert
    convert --> start
    size -->|no| start
    start --> token --> subtitles --> publish
  end

  transcribe[Transcribe]
  resume[resume-lambda]
  translate[Translate]
  transcriptSubtitle[Transcript and subtitle bucket]
  appBus[EventBridge application bus]
  topic[SNS topic]
  queue[Consumer queue]

  client -->|file name and hash| presign
  presign -->|15-minute upload URL| client
  client -->|job query| status
  status --> table
  client -->|MP4 bytes| videoUpload
  videoUpload -->|Object Created| defaultBus
  defaultBus -->|bucket, key, etag| starter
  starter --> table
  starter -->|start execution| mark
  convert -->|audio-only file| transcriptSubtitle
  start -->|start job| transcribe
  transcribe -->|transcript JSON| transcriptSubtitle
  transcribe -->|Job State Change, COMPLETED or FAILED| defaultBus
  defaultBus -->|rule invokes resume-lambda| resume
  resume -->|task success| token
  subtitles --> translate
  subtitles -->|WebVTT and SRT| transcriptSubtitle
  publish --> table
  publish -->|job id, status, subtitle keys| appBus
  appBus --> topic
  topic --> queue
```

The web client and the two function URLs share the CloudFront hostname. The function URLs require IAM, and CloudFront is the caller. Other teams do not appear in the diagram as callers of the state machine. They subscribe to the bus or to the consumer queue. The decision records are [0001](architecture-decision-records/0001-storage.md) through [0006](architecture-decision-records/0006-same-video-one-job.md). The step-by-step path is the [workflow](workflow.md). The longer walk, with cost and trade-offs at the end, is [How one video becomes subtitles](../understanding-the-pipeline.md).
