# 0002. Standard workflow, woken by events

## Status

Accepted

## Context

Transcription of a batch file takes longer than a few minutes and must not run twice for the same upload. The workflow has to pause until Transcribe finishes, then continue. EventBridge cannot write the job row.

## Decision

A Standard Step Functions state machine owns the job. S3 Object Created starts it through a small function that writes the row only if the job id is new. The machine calls `StartTranscriptionJob`, stores a task token on the row, and waits. Transcribe Job State Change wakes the machine. The machine does not poll. Express workflows are not used.

## Alternatives

- Express workflows. They stop at five minutes, run at least once, and cannot wait on a task token.
- A Lambda loop that calls `GetTranscriptionJob`. Each loop is another state transition, and a retry can start a second transcription.
- EventBridge writing straight to DynamoDB. The rule targets do not do a conditional status update. The state machine does.
- A queue in front of Transcribe, including a FIFO queue. FIFO deduplication lasts about five minutes. The Transcribe job name already stops a second start. The account allows 250 concurrent batch jobs in the Region. If that quota fills, the later control is `AllowDeferredExecution`, Transcribe's own queue of up to 10,000 jobs. The limit is explained in [Trade-offs](../trade-offs.md#no-queue-in-front-of-transcribe).

## Trade-off

The wait is capped at four hours, which is the batch limit of the file Transcribe accepts. A second upload of the same object reuses the job id and the execution name. A forced language rerun uses a new execution name and a new transcription job name, because a finished Transcribe job name cannot be reused.

## Cost

Standard workflows are priced per state transition. The published free allowance is 4,000 transitions per month, and it does not expire after the first year. Waiting is one transition, not a poll loop. There is no queue between the stages of a single job.

The Europe (Frankfurt) on-demand rate in the AWS Price List, effective 1 July 2025, is **$0.000025 per state transition**. That is the same figure the US East pricing example uses. Express workflows are priced per request and per GB-second instead, and they still cannot wait on a task token.

A finished job whose file is under 2 GB enters about 13 states: mark the row running, choose the path, start Transcribe, wait once, build the subtitles, save the status, publish the event, and succeed. A file over 2 GB adds the audio extract and one pass after it, about 15 states. A retry of the start adds more.

**The same demo month as the storage decision: 100 jobs, each under 2 GB.** 100 × 13 is 1,300 transitions. That sits inside the 4,000 free transitions, so Step Functions for that month is **$0**.

**A heavier month of 1,000 such jobs** is 13,000 transitions. After the free 4,000, 9,000 are billed. 9,000 × $0.000025 is about **$0.23**.

A loop that called `GetTranscriptionJob` every 30 seconds for the four-hour cap would add about 480 transitions per job. One hundred of those jobs would be about 48,000 extra transitions, about **$1.20** once the free allowance is spent, and a retry of that loop can start a second transcription. The functions the machine calls, and the event it publishes, are billed on their own services and are not in these figures.

## Failure

A start error reads the transcription job once. If it is already running, the machine waits. If it never finishes, the job is marked failed and the reason is stored on the row. A duplicate completion event finds a closed token and stops. Each rule has a dead-letter queue. The workflow log level is ALL, and the log omits the execution payload so the task token is not copied into CloudWatch.
