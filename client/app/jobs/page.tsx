/** Jobs page. Lists every recent localization job. */

import { JobList } from "@/components/job-list";
import { Shell } from "@/components/shell";

/** Renders the full job list. */
export default function JobsPage() {
  return (
    <Shell
      title="Jobs"
      description="Every recent job, including ones still running and ones waiting for a language choice."
    >
      <JobList from="jobs" empty="No jobs yet." />
    </Shell>
  );
}
