/** Gallery page. Lists jobs that finished with subtitle files. */

import { JobList } from "@/components/job-list";
import { Shell } from "@/components/shell";

/** Renders completed jobs. */
export default function GalleryPage() {
  return (
    <Shell title="Gallery" description="Succeeded jobs. Open one, then open a subtitle file to watch that language.">
      <JobList from="gallery" status="completed" empty="No succeeded jobs yet." />
    </Shell>
  );
}
