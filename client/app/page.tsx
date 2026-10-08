/**
 * Home page. Reads as the path from a named MP4 to the subtitle files.
 * A cue is one subtitle: the words shown between a start time and an end time.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { profileCopy } from "@/lib/profiles";

/** Renders the end-to-end path an operator can read before uploading. */
export default function Home() {
  return (
    <Shell
      title="Localization web client"
      description="Speech in an MP4 becomes English, German, and Spanish subtitle files. The uploaded video is what you play. Open this site on the CloudFront hostname from the edge stack output ConsoleUrl. A local dev server can show the pages, and it has no API behind it."
    >
      <div className="flex max-w-3xl flex-col gap-6">
        <PathSection title="1. Name the file, then upload">
          <p>
            The last word of the file name is the profile. <Code>sample_02_interview.mp4</Code> is an interview. The
            presign function accepts that word only when it is a profile in the stage config. A file over 5 GB is
            refused before any bytes leave the browser.
          </p>
          <ProfileTable />
          <p>
            The browser hashes the MP4 (SHA-256) and calls <Code>POST /api/uploads</Code>. CloudFront forwards that
            call to the presign function. The function URLs require IAM, and CloudFront is the caller, so the browser
            and the API share one hostname. If this hash, size, profile, and the three subtitle languages already
            belong to a job, that job opens and the file is not sent again. Otherwise you receive a 15-minute PUT URL.
            The MP4 goes straight to the video upload bucket at <Code>video-upload/{"{profile}"}/{"{id}"}.mp4</Code>. S3
            checks the hash against the bytes. A mismatch is rejected, and no job starts.
          </p>
        </PathSection>

        <PathSection title="2. The bucket starts the job">
          <p>
            The pages do not start the workflow. When the object lands, S3 publishes <Code>Object Created</Code> on the
            EventBridge default bus. The starter function writes one row in the DynamoDB job table and starts one Step
            Functions execution. The same bytes do not become a second job.
          </p>
        </PathSection>

        <PathSection title="3. The workflow listens, then writes six files">
          <p>
            The state machine marks the job <Code>running</Code>. An MP4 of 2 GB or less is read as it is. A larger
            file has the sound pulled out first: MediaConvert writes an audio-only file, and Transcribe reads that. The
            uploaded MP4 stays as it was.
          </p>
          <p>
            Amazon Transcribe listens for English, German, or both in one file. The workflow then waits, up to four
            hours, until the transcript is ready. The job page is what polls: every two seconds while the status is{" "}
            <Code>received</Code> or <Code>running</Code>.
          </p>
          <p>
            Words are grouped into cues. A cue is one subtitle, the words between a start time and an end time. A cue
            already in English, German, or Spanish is copied. The others go through
            Amazon Translate. WebVTT and SRT are written for each language, six files, numbered from 1. Timestamps stay
            on the cue.
          </p>
          <p>
            A file with no speech ends as <Code>empty</Code>, with no subtitle files. If the language confidence is too
            low, the job stops as needs review before translation. When the transcript contains more than one language,
            you can accept it and the subtitle step runs again from the stored transcript. Otherwise you can force{" "}
            <Code>en-US</Code> or <Code>de-DE</Code>, which starts Transcribe again for the whole file. If the speaker
            count hits the profile ceiling, the job is marked saturated.
          </p>
        </PathSection>

        <PathSection title="4. The result is saved, and other systems are told">
          <p>
            The state machine is the only writer of <Code>status</Code>. It stores the finished status on the job row
            and publishes one event on the application bus: completed, failed, needs review, or empty. That event is
            delivered to an SNS topic and then to the consumer queue. The message names the job and the subtitle keys.
            A download URL is left out, because it would expire in the queue. Other systems subscribe there. They do
            not read the job table.
          </p>
        </PathSection>

        <PathSection title="5. Where you look">
          <p>
            <PageLink href="/jobs">Jobs</PageLink> lists recent rows. <PageLink href="/gallery">Gallery</PageLink> lists{" "}
            <Code>completed</Code>. <PageLink href="/failures">Failures</PageLink> lists <Code>failed</Code>, with the
            reason. Needs review and empty stay on Jobs.
          </p>
          <p>
            Open a WebVTT or SRT link. The watch page plays the original video and moves that language under it. The
            video link and the subtitle link last 15 minutes. Reload the job when a link has gone stale.
          </p>
          <p>There is no login in this version. Anyone who can open the CloudFront hostname can upload.</p>
        </PathSection>
      </div>
    </Shell>
  );
}

/** One stretch of the path, with a title and the sentences under it. */
function PathSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

/** The three profiles, in the same words as the upload form. */
function ProfileTable() {
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">What each profile asks Transcribe to do</caption>
      <thead>
        <tr className="border-b text-muted-foreground">
          <th scope="col" className="py-2 pr-4 font-medium">
            Profile
          </th>
          <th scope="col" className="py-2 font-medium">
            What Transcribe is asked to do
          </th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(profileCopy).map(([id, copy]) => (
          <tr key={id} className="border-b last:border-b-0">
            <th scope="row" className="py-2 pr-4 font-mono font-normal text-foreground">
              {id}
            </th>
            <td className="py-2 text-foreground">{copy.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A file name, route, or status, set in the monospace face. */
function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.8125rem] text-foreground">{children}</code>;
}

/** A link to one list in the web client. */
function PageLink({ href, children }: { href: "/jobs" | "/gallery" | "/failures"; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-foreground underline underline-offset-4">
      {children}
    </Link>
  );
}
