/**
 * Maps a content profile to the Transcribe settings and the input the state machine receives.
 */

export interface ProfileSettings {
  speakerLabels: boolean;
  maxSpeakers?: number;
  multiLanguage?: boolean;
}

export type TranscriptionMode = "highlights" | "speakers" | "multi";

/** Chooses highlights, speaker labels, or mixed-language detection from the profile. */
export function transcriptionMode(profile: ProfileSettings): TranscriptionMode {
  if (profile.multiLanguage) {
    return "multi";
  }
  if (profile.speakerLabels) {
    return "speakers";
  }
  return "highlights";
}

export interface ExecutionInput {
  jobId: string;
  profile: string;
  mode: TranscriptionMode;
  mediaUri: string;
  transcriptKey: string;
  transcriptionJobName: string;
  maxSpeakers: number;
  targetLanguages: string[];
  forceLanguage?: string;
  objectSize: number;
  acceptDetected: boolean;
  audioDestination?: string;
  audioUri?: string;
}

/** Builds the payload the state machine reads, including the media URI and the transcript key. */
export function executionInput(input: {
  jobId: string;
  profile: string;
  profileSettings: ProfileSettings;
  bucket: string;
  key: string;
  targetLanguages: string[];
  transcriptionJobName: string;
  forceLanguage?: string;
  objectSize?: number;
  acceptDetected?: boolean;
  audioDestination?: string;
  audioUri?: string;
}): ExecutionInput {
  const body: ExecutionInput = {
    jobId: input.jobId,
    profile: input.profile,
    mode: transcriptionMode(input.profileSettings),
    mediaUri: `s3://${input.bucket}/${input.key}`,
    transcriptKey: `transcripts/${input.transcriptionJobName}.json`,
    transcriptionJobName: input.transcriptionJobName,
    maxSpeakers: input.profileSettings.maxSpeakers ?? 2,
    targetLanguages: input.targetLanguages,
    objectSize: input.objectSize ?? 0,
    acceptDetected: input.acceptDetected === true,
  };
  if (input.forceLanguage) {
    body.forceLanguage = input.forceLanguage;
  }
  if (input.audioDestination) {
    body.audioDestination = input.audioDestination;
  }
  if (input.audioUri) {
    body.audioUri = input.audioUri;
  }
  return body;
}
