/** Failures page. Lists jobs that stopped, with the reason. */

import { JobList } from "@/components/job-list";
import { Shell } from "@/components/shell";

/** Renders failed jobs. */
export default function FailuresPage() {
  return (
    <Shell
      title="Failures"
      description="Jobs that stopped, with the reason. A job that needs a language choice stays on the jobs list."
    >
      <JobList from="failures" status="failed" empty="No failed jobs." />
    </Shell>
  );
}
