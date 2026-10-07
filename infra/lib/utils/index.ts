/**
 * Names for this app.
 * Physical AWS names come from resourceName. CDK construct ids come from stagified.
 */

const S3_MAX_LENGTH = 63;

export interface NameParts {
  service: string;
  name: string;
}

/**
 * Physical name shared by every stack: {service}-{name}-{purpose}-{stage}.
 * A TitleCase purpose such as WorkflowHealthDashboard is split into hyphens, then lowercased.
 * Bucket names are derived here and are never read from the environment.
 */
export function resourceName(parts: NameParts, purpose: string, stage: string, maxLength = S3_MAX_LENGTH): string {
  const raw = [parts.service, parts.name, hyphenateTitleCase(purpose), stage].join("-").toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  const trimmed = cleaned.slice(0, maxLength).replace(/-+$/, "");
  if (trimmed.length < 3) {
    throw new Error(`Resource name "${raw}" cannot be trimmed to ${maxLength} characters`);
  }
  return trimmed;
}

/**
 * Construct id with the stage appended, such as WorkflowHealthDashboardDev.
 * Pass false for the hyphenated form, such as workflow-dev.
 */
export function stagified(id: string, stage: string, toTitleCase = true): string {
  if (toTitleCase) {
    return `${id}${stage.charAt(0).toUpperCase() + stage.slice(1)}`;
  }
  return `${id}-${stage.toLowerCase()}`;
}

/** Inserts a hyphen between words in a TitleCase string. */
function hyphenateTitleCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2");
}
