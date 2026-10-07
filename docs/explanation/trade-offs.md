# Trade-offs

These are deliberate limits of the current design. Each one is here because the brief asks for subtitle files, or because the extra work has a standing cost. The prices and the same limits, read after the path of one video, are in [How one video becomes subtitles](../understanding-the-pipeline.md#cost-and-trade-offs).

## Deployed from a laptop

There is no GitLab or GitHub Actions pipeline. `cdk deploy` runs locally. An automated pipeline would need an identity provider, a review of every change set, and a prod approval gate. That is real work and it is not what the on-site session reviews.

## One region, no VPC

Transcription, translation, storage, and the workflow are regional managed services. They already run across availability zones. A VPC would add a NAT gateway, which is a monthly charge even when no video is processed. Multi-region active-active is a second pipeline. It stays out.

## No queue in front of Transcribe

Amazon Transcribe allows 250 batch jobs at once in each Region. The quota can be raised. This pipeline starts the transcription from the state machine. A demo, and a normal upload, will not fill those 250 slots. The start call retries a throttle. If Transcribe still refuses the job, the run is stored as failed.

A queue of our own stays off, including a FIFO queue. FIFO deduplication lasts about five minutes. The lock that stops a second transcription is the Transcribe job name, and that name lasts for the life of the job. The same name is the state machine execution name.

If a match day fills the 250 slots, the later control is Transcribe's own waiting line, `AllowDeferredExecution`. That queue holds up to 10,000 jobs and starts them as slots free. It uses the same job name. The decision is recorded in [0002](architecture-decision-records/0002-orchestration.md).

## Polling, not a socket

The web client reads job status on an interval. A transcription takes minutes, so a two-second delay before the page flips to done does not change when the subtitles appear. A WebSocket API adds a connection table and idle-timeout handling. It can be a subscriber on the event bus later.

## Anonymous speakers

The feature profile asks Transcribe for up to six speaker labels, and the interview profile asks for three. The labels are `spk_0` and so on. Naming the person requires a face roster or a celebrity index, and face data is a separate privacy decision. A voice beyond the ceiling is merged into an existing label. A result that uses every slot is marked saturated, because a voice may have been split or merged.

## Translate only

Cue text is translated with Amazon Translate, and the timestamps are copied. A language-model rewrite is not part of the pipeline. MediaConvert writes an audio-only file only when the MP4 is over Transcribe's 2 GiB limit. The uploaded MP4 stays what the web client plays. Evened-out volume and burned-in captions stay off.

## Banners stay in the picture

Lower-thirds, such as a club crest and a "youngest goalscorer" graphic, are designed into the frame. Translating the words is cheap. Rebuilding the graphic means a new video. The mission asks for subtitle files, so the banner stays in the original language. Detecting it and burning a replacement is a later step.

## Review is a later loop

A low-confidence language detection stops before translation and is stored as needs review. The web client can force `en-US` or `de-DE`, which transcribes the file again. When the stored transcript already contains more than one language, the web client can accept it and write the subtitle files without a new transcription. A person cannot yet correct a line and feed that correction back into a vocabulary. That loop is what makes the subtitles broadcast-quality. This version produces the first draft and surfaces the failure.

## English samples, German brief

The brief describes German source video. The files on hand are English, and one of them mixes both. Detection with the allow-list `en-US` and `de-DE` covers both without a second pipeline. Every profile may be English, German, or both in one file. Translation follows each subtitle.

## MP4 only

The web client accepts a file whose name ends in `.mp4`, up to 5 GB. An MP4 of 2 GiB or less is read by Transcribe directly. A larger MP4 has an audio-only copy made first. Other containers, such as MOV or MKV, are a later step if there is time. That step also has to confirm Transcribe can read the new type.

## Same video, one job, up to 5 GB

A single PUT can be at most 5 GiB. The web client and the presign function both refuse a larger file. The identity is the SHA-256 of the whole file, the object size, the profile, and the sorted subtitle languages. The file name is not the identity. S3 checks the SHA-256 on the PUT, so a hash sent by the web client is not accepted as proof of the bytes.

Above 5 GiB, S3 requires a multipart upload. SHA-256 of a multipart object is a checksum of the parts, so the same file can hash differently when the part boundaries change. The later path, not built, identifies a multipart upload with CRC-64/NVME and checksum type `FULL_OBJECT`. That checksum does not depend on part size.

It would sit in the same three places as the single-part check:

- The web client upload would hash each part with CRC-64/NVME instead of SHA-256 of the whole file.
- The presign function would return one URL per part, and the complete call would set the full-object checksum.
- The starter would read that checksum from the completed object and use it in the same lock.

```
if size <= 5 GiB:
  identity = sha256(file) + size + profile + languages
  single PUT with ChecksumSHA256
else:
  identity = crc64nvme(file) + size + profile + languages
  multipart upload
  complete with ChecksumType = FULL_OBJECT
```

## No login on the web client

The function URLs require IAM, and CloudFront is the only caller. Anyone who can open the hostname can request an upload URL. A user pool and a JWT check can sit in front of the same two functions later. API Gateway is the place for that authorizer. It is not on the path today.

## No web application firewall

The web client is a demo on the CloudFront default hostname. A firewall in front of it is a monthly charge even when nobody uploads a video, so it stays off until a real domain is in front of the site.

## No custom domain

The web client uses the hostname CloudFront already provides, and that hostname already has HTTPS. A Route 53 hosted zone is a monthly charge. An ACM certificate, plus A and AAAA records, exists only to attach a domain you choose. This demo has no domain, so those records have nothing to point at. The hosted zone, the certificate, and the records turn on together when `deployCustomDomain` is true.

## Any origin may call the media buckets

The web client uploads the MP4 straight to S3, then later plays the video and downloads the subtitle files. Those calls leave the CloudFront hostname, so the buckets tell the web client the call may finish. The upload bucket allows `PUT` and `HEAD`. The transcript and subtitle bucket allows `GET` and `HEAD`.

`allowedOrigins` is `*`. The hostname CloudFront assigns appears only after the distribution exists, and the distribution is built from these buckets. Naming that hostname on the bucket would make each wait for the other. A local Next.js session is a second origin, `http://localhost`.

The objects stay private. Block Public Access stays on, and S3 still checks the signature on the presigned URL. That URL expires in 15 minutes. The rule only lets the web client complete a request that already carries a valid URL.

`https://*.cloudfront.net` would avoid the cycle. It would still allow every CloudFront site, and a local session would be left out. A domain written in config can replace `*` once `deployCustomDomain` is true, because that name is chosen before the distribution exists.

## CloudWatch for alarms and logs

Lambda, Step Functions, and the dead-letter queues already write their logs and counts to CloudWatch. The dashboard counts four job outcomes from the workflow log, plus execution crashes and dead-letter depth. A job stored as failed is visible even when the execution ends successfully. Each outcome is one CloudWatch custom metric. A platform such as Datadog would copy those same signals out of AWS and add a second bill. The alarms are a crashed execution, a stored job failure, a message on a dead-letter queue, and the monthly budget.

## Other teams use the event, not the table

A publishing or archive system subscribes to the application bus or the consumer queue. The event names the job and the subtitle keys. Those teams do not get a grant on the job table or a way to start Transcribe. Burned-in captions, a dubbed track, and a rebuilt banner are their workflows, started from `LocalizationJobCompleted`.
