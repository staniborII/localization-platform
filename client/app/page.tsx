/** Home page. Points the operator at upload and explains what the web client does. */

import { Empty } from "@/components/empty";
import { Shell } from "@/components/shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Renders the short introduction. */
export default function Home() {
  return (
    <Shell
      title="Localization web client"
      description="Upload a video, follow the transcription, and open the subtitle files when a job succeeds."
    >
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>How a job runs</CardTitle>
          <CardDescription>
            The pages call the CloudFront hostname. A local dev server has no API behind it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
            <li>Name the MP4 so the last word is the profile, as in sample_02_interview.mp4.</li>
            <li>Upload. The file lands in the video upload bucket and a job starts.</li>
            <li>Open a WebVTT or SRT link to watch the video with that language moving under it.</li>
          </ol>
        </CardContent>
      </Card>
      <Empty>Deploy the edge stack, then open the CloudFront URL from the stack output.</Empty>
    </Shell>
  );
}
