# Configuration

Stage behavior lives in `infra/config/config.dev.yml` and `infra/config/config.prod.yml`. The deploy target lives in `infra/.env`, which is not committed. `infra/.env.example` lists the keys.

Synth refuses to run when `AWS_ACCOUNT_ID` or `AWS_REGION` is missing from the environment.

## Environment

| Key | Meaning |
|---|---|
| `STAGE` | `dev` or `prod` |
| `AWS_PROFILE` | Local AWS CLI profile. May be empty for synth. |
| `AWS_ACCOUNT_ID` | Twelve-digit account. |
| `AWS_REGION` | Region for every stack. `eu-central-1`. |

`.env` uses account `000000000000` so synth works before a real account is chosen. Replace that placeholder before deploying.

## Stage file

| Key | Meaning |
|---|---|
| `service`, `name` | Inputs to physical names. Pattern: `{service}-{name}-{purpose}-{stage}`. |
| `owner` | Tag value. |
| `removalPolicy` | `destroy` in dev, `retain` in prod. |
| `budgetUsd` | Monthly spend alarm, in US dollars. A ceiling, not a service price. |
| `features.deployCustomDomain` | When false, CloudFront uses its default hostname. |
| `features.audioNormalization` | Off. This flag would use MediaConvert only to even out the volume. A file over 2 GiB still has its audio extracted so Transcribe can read it. That extract is not this flag. |
| `features.burnInCaptions` | Burned-in captions. Off. |
| `features.realtimeStatus` | `poll` only, in this version. |
| `languages.candidates` | Allow-list for detection. `en-US`, `de-DE`. |
| `languages.outputs` | Subtitle languages. `en`, `de`, `es`. |
| `profiles` | Per-content transcription settings. |
| `defaultProfile` | A profile that must exist in `profiles`. Uploads take the profile from the file name. |
| `runtime` | Cue length, poll interval, and the language-confidence floor. |

## Profiles

| Profile | Speaker labels | Ceiling | Mixed language |
|---|---|---|---|
| `highlights` | no | — | yes |
| `interview` | yes | 3 | yes |
| `feature` | yes | 6 | yes |

`maxSpeakers` is required when speaker labels are on. The value is a ceiling from 2 to 30. Mixed language means the file may be English, German, or both. A file that uses only one of those is still accepted.

A new classification is a new key under `profiles` in both stage files, with `speakerLabels`, `maxSpeakers` when labels are on, and `multiLanguage: true`. Name the MP4 so the word after the last underscore is that key, then deploy so the functions receive the new settings. The presign function rejects a word that is not in the file.
