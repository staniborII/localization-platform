# 0003. Transcribe the file, translate the subtitles

## Status

Accepted

## Context

The brief asks for subtitle files from speech. The sample highlights are English, the brief assumes German, and the feature file mixes both. The subtitle languages the reviewers named are English, German, and Spanish, and the brief was met by writing any one of those three. This design writes all three. Spanish is a subtitle file only. The pipeline does not listen for spoken Spanish. The video may have no subtitle track. Burned-in banners are graphics, not speech.

## Decision

Amazon Transcribe batch reads the spoken audio from S3. Two buckets hold it:

- The video upload bucket holds the MP4 at `video-upload/{profile}/{id}.mp4`.
- The transcript bucket holds three prefixes. `transcripts/` is the transcript JSON. `subtitles/` is the WebVTT and SRT files. `audio/` is an audio-only MP3, and it is written only when the MP4 is too large for Transcribe.

Transcribe uses the workflow role that started the job. That role is allowed to read the MP4 and the MP3, list both buckets, and write the transcript under `transcripts/`. It may read `video-upload/*` in the video upload bucket and `audio/*` in the transcript bucket. It may list those two buckets. It may write `transcripts/*` in the transcript bucket.

An MP4 of 2 GiB or less is read as uploaded. An MP4 larger than 2 GiB, and still within the 5 GiB single-part upload limit, goes through MediaConvert first. MediaConvert reads the MP4 and writes a mono MP3 at `audio/{jobId}.mp3` in the transcript bucket. Transcribe then reads that MP3. The uploaded MP4 stays the file the web client plays.

Language identification is limited to spoken `en-US` and `de-DE`. Every profile may find English, German, or both in one file. Highlights do not label speakers. The interview ceiling is three speakers. The feature ceiling is six. Labels stay anonymous.

A cue already in English, German, or Spanish is copied. The others go through `TranslateText`, which is asked to keep the line short. Timestamps are copied, not translated. WebVTT and SRT are written to `subtitles/{jobId}/{lang}.vtt` and `.srt` in the transcript bucket, numbered from 1.

## Alternatives

- A fixed source language. That matches one of the samples and misses the other. Detection is one request flag.
- Amazon Transcribe's own subtitle file as the only output. Those files are in the source language. They do not produce the other two.
- MediaConvert on every file. Transcribe accepts an MP4 of 2 GiB or less directly, so that extra file is unnecessary for the samples. It is used only when the MP4 is over Transcribe's 2 GiB limit. A reserved MediaConvert queue is a 12-month charge and stays off. Lambda with ffmpeg was set aside: a 2 GiB file does not fit a Lambda disk or the 15-minute limit.
- A language model rewriting every subtitle. That is a second cost on the path that already dominates the bill.

## Trade-off

A score below 0.8 stops the job before translation and stores it as needs review. The web client can rerun that job with `en-US` or `de-DE`, which starts Transcribe again for the whole file. When the stored transcript already contains more than one language, the web client can also accept it. That writes the subtitle files from the transcript already in the bucket and does not start Transcribe again. Speaker labels are anonymous. A result that fills the ceiling is marked saturated. Banners stay in the picture. A file with no speech ends as empty and does not publish blank language files. Splitting a file that is still over 2 GiB or 8 hours after the audio extract, and shifting the cue times, is a later path.

## Cost

Transcribe batch is priced per second of audio, billed monthly. That is the cost that matters. Translate standard text is priced per character. The published rate on the Translate pricing page is $15 per million characters. Translate is asked to keep each subtitle short. If that language pair cannot do a short translation, the subtitle is translated again without that request. There is no standing charge for either service.

MediaConvert is used only for an MP4 over 2 GiB. It is available in `eu-central-1`. On-demand jobs are priced per normalized minute of output, billed in 0.01 minute increments. A reserved queue is a 12-month standing charge and stays off. The `audioNormalization` flag stays false: that flag is evened-out volume, which this extract does not do.

## Failure

A failed transcription stores the service reason on the job and publishes `LocalizationJobFailed`. A low confidence score publishes `LocalizationJobNeedsReview` and writes no subtitle files. If MediaConvert cannot write the audio file, the job is stored as failed and the service reason is kept. Translate errors fail the job after the transcript exists, so the run can be inspected. Transcribe, Translate, and MediaConvert are available in `eu-central-1`.
