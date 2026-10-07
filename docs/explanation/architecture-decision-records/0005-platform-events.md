# 0005. Other teams subscribe to the job event

## Status

Accepted

## Context

The pipeline is one capability inside a media platform. A publishing team, a social team, or an archive team should not call Transcribe, read the job table, or change the state machine. They need to know when subtitle files exist and where those files are.

## Decision

The state machine publishes one event to an application bus when a job reaches a terminal status. The source is `bundesliga.localization`. The detail types are `LocalizationJobCompleted`, `LocalizationJobFailed`, `LocalizationJobNeedsReview`, and `LocalizationJobEmpty`. The detail carries version 1, the job id, the profile, the detected language, the reason, and the subtitle keys. A rule on that bus publishes to an SNS topic. A consumer queue is subscribed to the topic. Email is not subscribed. Another team adds a rule on the bus, or reads the queue. They do not get a database credential.

## Alternatives

- Callers reading DynamoDB. That couples them to the item shape and to this pipeline's table.
- Putting a presigned URL in the event. The URL would expire inside the consumer's queue and would be copied into logs. The event carries the bucket key. The consumer's role is granted read on `subtitles/*` if that team is allowed to fetch the file.
- A processing queue between Transcribe and translation. That is a concurrency valve, not a notification. It is not on this path.

## Trade-off

SNS and SQS deliver at least once. A consumer must treat the job id as the idempotency key. The consumer queue can hold messages until a partner attaches. That is expected, and it is not alarmed. Dead-letter queues are alarmed. The event does not include the task token or the source video.

## Cost

Custom events on the application bus are priced per event. SNS is priced per publish. SQS is priced per request. No email subscription is created, so there is no recipient to confirm. The topic and the queues are encrypted with the service-managed keys, not a customer-managed key.

## Failure

If the bus cannot deliver to the topic, the event lands on the fanout dead-letter queue and the alarm fires. The subtitle files are already in the transcript and subtitle bucket. A partner can read them from the key in the job row after the notification is replayed. A consumer that fails a message uses the queue's own dead-letter queue.
