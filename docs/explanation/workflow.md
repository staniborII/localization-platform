# Workflow

A job starts when an MP4 lands in the video upload bucket and ends when subtitle files are in the transcript and subtitle bucket, or when the job row records why it stopped. The state machine is the only writer of `status`. The subtitle step writes the language, the subtitle keys, and the speaker-saturation flag. The longer walk is [How one video becomes subtitles](../understanding-the-pipeline.md).

## Upload

The web client hashes the file and sends the file name, the SHA-256, the size, and the profile to `/api/uploads`. The presign function reads the profile from the word after the last underscore, as in `sample_02_interview.mp4`, and accepts it only when that word is a profile in the stage config. A posted profile that disagrees with the file name is rejected. A file over 5 GB is rejected. If that hash, size, profile, and subtitle languages already belong to a job, the function returns that job and does not sign a PUT. Otherwise it returns a 15-minute PUT URL for `video-upload/{profile}/{id}.mp4`, and S3 checks the SHA-256 when the bytes arrive. The function never reads the video bytes.

## Start

S3 emits Object Created. The starter function reads the size and the full-file checksum. It builds the job id from the bucket, the key, the etag, the profile, and the output language list. It also writes a content lock from the checksum, the size, the profile, and the output languages, and only when that lock is new. A second object with the same bytes finds the lock and does not become a second job. The job row is written only when the job id is new. The starter then starts an execution whose name is the job id. A second event for the same object finds the row and, if the execution already exists, stops. An unknown profile, a missing checksum, or a file over 5 GB is stored as failed and does not start an execution.

The execution input names the mode and the object size. An MP4 over 2 GiB is extracted to an audio-only file before Transcribe. Every profile may be English, German, or both in one file. Highlights do not label speakers. The interview allows three speakers. The feature allows six.

## Transcription

The machine sets the row to `running`. If the person accepted a mixed transcript, it goes straight to the subtitle step and does not call Transcribe. Any other run calls `StartTranscriptionJob`. When the object is larger than 2 GiB, MediaConvert writes `audio/{jobId}.mp3` in the transcript and subtitle bucket, and Transcribe reads that file. There is no separate audio bucket. A smaller MP4 is read directly. The transcription job name is the job id. A token function writes the wait token onto the row and returns. The machine waits up to four hours. Transcribe writes the transcript JSON under `transcripts/`.

When Transcribe emits a completed or failed job, the resume function loads the token and calls `SendTaskSuccess`. That action is allowed on this state machine. The task token still names the waiting execution. A token that is already closed is ignored. If the wait ends first, the machine reads the transcription job once. A completed job continues. Anything else is stored as failed. The job page can send that same success call when the transcript is already done and the run is still waiting. The page follows the execution name stored on the row, and a still-running job follows its open execution rather than an older finished one.

## Subtitles

The subtitle step reads the transcript and stores the spoken languages it finds. A language score below 0.8, and no forced language, and no accepted transcript, stops the job as `needs_review`. The web client can post `en-US` or `de-DE` for that job. That starts a new execution and a new transcription job name, because the first job name cannot be reused. When the stored transcript contains more than one language, the web client can instead accept it. That starts an execution named `{jobId}-a1` which writes the subtitle files from the transcript already stored and does not start Transcribe again. No speech stores the job as `empty`.

Otherwise the words are grouped into cues. A cue is one subtitle: the words shown between a start time and an end time. A new one starts on a pause, a speaker change, a language change, a line that would be too long, or speech that would be too fast to read. A subtitle already in English, German, or Spanish is copied. The others are translated, and Translate is asked to keep them short. WebVTT and SRT are written to `subtitles/{jobId}/{lang}.vtt` and `.srt`. The files are numbered from 1.

## Notify

The machine sets the terminal status and publishes one event. The detail types are listed in the [event reference](../reference/events.md). The application bus fans the event out to an SNS topic and a consumer queue. Publishing, social, or archive systems subscribe there. They do not read the job table.

## What the web client shows

The jobs page lists recent rows. The gallery lists `completed`. The failures page lists `failed`. Needs-review and empty jobs stay on the jobs page. The detail page is `/job?id=`. It polls every two seconds while the status is `received` or `running`. A succeeded job plays the video and lists one language of cues under it. English, German, and Spanish can each be selected. WebVTT and SRT open `/watch?id=&lang=&format=`, which plays the video and moves the matching line as the video plays. The address keeps `from` so Back returns to Jobs, Gallery, Failures, or Upload, and that tab stays filled. The page asks for a fresh file link when it loads. Those links expire in 15 minutes.
