# Events

The application bus receives events from the state machine. The source is `bundesliga.localization`.

| Detail type | When |
|---|---|
| `LocalizationJobCompleted` | Subtitle files were written. |
| `LocalizationJobFailed` | The job stopped with an error. |
| `LocalizationJobNeedsReview` | Language confidence was below the floor. No subtitle files were written. |
| `LocalizationJobEmpty` | The file had no speech. |

Detail shape:

```json
{
  "version": 1,
  "jobId": "0123456789abcdef0123456789abcdef",
  "profile": "feature",
  "status": "completed",
  "sourceLanguage": "en-US",
  "reason": "",
  "outputs": [
    { "lang": "en", "vttKey": "subtitles/0123456789abcdef0123456789abcdef/en.vtt", "srtKey": "subtitles/0123456789abcdef0123456789abcdef/en.srt" }
  ]
}
```

`version` is 1. A consumer treats `jobId` as its idempotency key. Delivery is at least once. The event does not contain a presigned URL.

A rule forwards every event from this source to an SNS topic. A queue is subscribed to that topic with raw message delivery. Email is not subscribed. Another team adds a rule on the bus or consumes the queue.

Video upload and transcription use the default bus, not this contract. Those events are `Object Created` and `Transcribe Job State Change`. They are internal.
