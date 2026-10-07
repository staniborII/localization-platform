/** Upload page. Hosts the form that sends an MP4 to the video upload bucket. */

import { Shell } from "@/components/shell";
import { UploadForm } from "@/components/upload-form";

/** Renders the upload form. */
export default function UploadPage() {
  return (
    <Shell
      title="Upload"
      description="The file goes straight to the video upload bucket. Subtitle languages are English, German, and Spanish."
    >
      <UploadForm />
    </Shell>
  );
}
