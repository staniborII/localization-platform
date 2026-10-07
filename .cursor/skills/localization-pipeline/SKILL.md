---
name: localization-pipeline
description: Domain rules for the video localization pipeline. Use when designing or changing ingest, transcription, translation, subtitles, profiles, or job status.
---

# Localization pipeline

Speech in, subtitle files out. The video file is not rewritten in this version.

## Languages

- Detect spoken language with `IdentifyLanguage` and candidates `en-US`, `de-DE`.
- Every profile sets `multiLanguage: true` and uses `IdentifyMultipleLanguages`. A file may be English, German, or both, and translation follows each cue.
- Output subtitle languages are `en`, `de`, and `es`.
- A cue already in an output language is copied. The others are translated. Timestamps stay on the cue.
- If language confidence is below `runtime.languageConfidenceMin`, stop before translation and store the job as needs review. The spoken languages found on the words are stored with that stop.
- When that list has more than one language, the web client can accept the stored transcript and write subtitles without a new transcription. Otherwise it can force `en-US` or `de-DE`, which starts Transcribe again for the whole file.

## Profiles

- `highlights`: no speaker labels.
- `interview`: speaker labels, ceiling 3.
- `feature`: speaker labels, ceiling 6.
- A new profile is a new key under `profiles` in both stage files, with the same language rule, then a deploy. The presign function rejects a name that is not in that file.
- Labels are anonymous (`spk_0` …). Do not name people.
- If the returned speaker count equals the ceiling, mark the job saturated.

## Outputs

Write WebVTT and SRT from cue JSON. Set the subtitle start index to 1. A file with no speech ends as empty, not as blank languages.

## Out of scope until an ADR

Burned-in banners and lower-thirds stay in the picture. Translation is Amazon Translate only. MediaConvert is used only to write an audio-only file when the MP4 is over 2 GiB. Volume normalization, burned-in captions, WebSockets, and a line-level review loop are follow-on work, not the default path.

## Platform

Other systems subscribe to the application bus or the consumer queue. They do not call the state machine or read the job table. The event contract is `bundesliga.localization` with detail types `LocalizationJobCompleted`, `LocalizationJobFailed`, `LocalizationJobNeedsReview`, and `LocalizationJobEmpty`.
