# 0001. Private buckets and a job table

## Status

Accepted

## Context

The pipeline accepts video files and returns subtitle files. A job runs for minutes, and the web client needs a status that survives a refresh. The video itself is not rewritten.

## Decision

Three private S3 buckets hold the video, the subtitle files, and the static web client. A DynamoDB table, billed on demand, stores one item per job. The job id is the partition key. A partition is the group name DynamoDB uses to find items. The detail page already knows the id, so it reads that one item.

The list pages do not know the ids. The table keeps two more groupings of the same items, each ordered by `updatedAt`, newest first, at most 50. The `recent` index puts every job in one group named `job` (`listPk`). The jobs page reads that group. The `status` index groups jobs by the status value. The gallery reads the `completed` group. The failures page reads the `failed` group. The page names the group, and DynamoDB returns the rows already in it.

## Alternatives

- One bucket with prefixes. A separate transcript and subtitle bucket keeps the transcription role from writing next to the source file.
- RDS or Aurora. A job row is a single item with a known key. A database instance would be a standing charge.

## Trade-off

The jobs list uses one group name (`listPk = job`), so every request for that page lands on one partition. That is enough for this web client. A high-rate public catalogue would split the name by day, as in `job#2026-10-07`, query today and yesterday, and merge to the newest 50. The gallery would do the same with `completed#2026-10-07`, because that group is the one public traffic would fill first. A catalogue that also needs search and filters would leave this table as the record of one job and serve the list from a search index. Object keys are not known at deploy time, so the function roles allow a prefix rather than a single key.

## Cost

S3 is priced per GB-month and per request. DynamoDB on-demand is priced per read request and per write request. Point-in-time recovery is enabled. There is no customer-managed KMS key, because that key is a monthly charge. Objects use SSE-S3.

These are the Europe (Frankfurt) on-demand rates from the AWS Price List, read in October 2026. The S3 storage rate took effect on 1 September 2026. They are list prices, before tax, and they change when AWS changes the price list.

| What | Frankfurt rate |
|---|---|
| S3 Standard storage, first 50 TB | $0.0245 per GB-month |
| S3 PUT, COPY, POST, or LIST | $0.0054 per 1,000 requests |
| S3 GET and the other reads | $0.00043 per 1,000 requests |
| DynamoDB write request unit | $0.7625 per million |
| DynamoDB read request unit | $0.1525 per million |
| DynamoDB table storage | The first 25 GB-months are free, then $0.306 per GB-month |
| DynamoDB point-in-time recovery | $0.2448 per GB-month of table data |

A write request unit covers 1 KB. A strongly consistent read request unit covers 4 KB. An eventually consistent read costs half of that. Each of the two indexes is written as well as the table, so one small update is three write request units.

**One demo month.** 100 jobs, each a 200 MB MP4 kept for the whole month, plus about 1 GB of transcripts, subtitle files, the site, and access logs.

| Line | Sum |
|---|---|
| 20 GB of video at $0.0245 | $0.49 |
| 1 GB of the other objects at $0.0245 | $0.02 |
| About 1,000 writes and 1,000 reads of those objects | under $0.01 |
| About 3,000 DynamoDB write units and 20,000 read units | under $0.01 |
| The job table is far under 25 GB, so its storage and point-in-time recovery | $0 |

S3 for that month is about **$0.52**. DynamoDB is under **$0.01**. Together about **$0.53**. The video sitting in the bucket is the part that matters. A busier month that leaves 1,000 GB in the bucket for the whole month is 1,000 × $0.0245, about **$25**, still inside the first storage tier. Downloading that video out to the internet is a separate data-transfer charge and is not in these figures.

## Failure

A conditional write rejects a second row for the same object, profile, and language list. The detail page reads the item with a strongly consistent get. The list pages can lag that read by about a second, because the indexes are eventually consistent. Dev deletes the buckets with the stack. Prod retains them.
