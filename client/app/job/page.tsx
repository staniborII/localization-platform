/**
 * Job detail. Shows the path of the run, plays the video with the subtitle cues underneath, and links each subtitle file to its own page.
 */

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Empty } from "@/components/empty";
import { Shell } from "@/components/shell";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JobJourney } from "@/components/job-journey";
import { SubtitleReader } from "@/components/subtitle-reader";
import { getJob, rerunJob, acceptDetected, continueWait, type Job } from "@/lib/api";
import { backToList, sectionFrom } from "@/lib/navigation";
import { holdJobMedia } from "@/lib/presign";
import { describeProfile } from "@/lib/profiles";

const POLL_MS = 2000;

/** Loads one job from the id query and refreshes it while it is still running. */
function JobBody() {
  const params = useSearchParams();
  const id = params.get("id");
  const place = sectionFrom(params.get("from")) ?? "jobs";
  const [job, setJob] = useState<Job | undefined>(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [continuing, setContinuing] = useState(false);
  const [reload, setReload] = useState(0);
  const mediaStamp = useRef(0);

  useEffect(() => {
    if (!id) {
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const result = await getJob(id);
        if (stop) {
          return;
        }
        const stamp = mediaStamp.current;
        setJob((previous) => (mediaStamp.current === stamp ? holdJobMedia(previous, result.job) : (previous ?? result.job)));
        setError("");
        if (result.job.status === "received" || result.job.status === "running") {
          timer = setTimeout(() => void tick(), POLL_MS);
        }
      } catch (caught) {
        if (!stop) {
          setError(caught instanceof Error ? caught.message : "The job could not be loaded.");
        }
      }
    };
    void tick();
    return () => {
      stop = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [id, reload]);

  /** Asks for a new video link after the one on screen has expired. A status poll does not call this. */
  async function refreshVideo(): Promise<string | undefined> {
    if (!id) {
      return undefined;
    }
    const result = await getJob(id);
    mediaStamp.current += 1;
    const stamp = mediaStamp.current;
    setJob((previous) => (mediaStamp.current === stamp ? result.job : (previous ?? result.job)));
    return result.job.videoUrl;
  }

  if (!id) {
    return (
      <Shell title="Job" section={place} back={backToList(place)}>
        <Empty>Open a job from the list. The id is passed as ?id=.</Empty>
      </Shell>
    );
  }

  const profile = job ? describeProfile(job.profile) : undefined;

  return (
    <Shell title={job?.fileName || "Job"} description={profile?.detail} section={place} back={backToList(place)}>
      {error ? <Empty tone="destructive">{error}</Empty> : null}
      {!error && !job ? <Empty>Loading the job.</Empty> : null}
      {job && profile ? (
        <div className="grid items-start gap-4 lg:grid-cols-5">
          {job.steps && job.steps.length > 0 ? (
            <div className="min-w-0 lg:col-span-3">
              <JobJourney steps={job.steps} status={job.status} />
            </div>
          ) : null}
          <Card className={job.steps && job.steps.length > 0 ? "lg:col-span-2" : "lg:col-span-5"}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{profile.label}</Badge>
                <StatusBadge status={job.status} />
              </CardTitle>
              <CardDescription>
                {job.sourceLanguage ? `Source ${job.sourceLanguage}` : "Source language not detected yet"}
                {job.languageConfidence !== null ? ` · confidence ${job.languageConfidence}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {job.speakerSaturation ? (
                <p className="text-sm text-muted-foreground">
                  Every speaker slot was used. A voice may have been merged or split.
                </p>
              ) : null}
              {job.failureReason && !job.steps?.some((step) => step.state === "failed") ? (
                <Empty tone="destructive">{job.failureReason}</Empty>
              ) : null}
              {notice ? <Empty>{notice}</Empty> : null}
              {job.canContinue ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">The transcript is ready. This run is still waiting for it.</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={continuing}
                    onClick={() => {
                      setNotice("");
                      setContinuing(true);
                      void continueWait(job.jobId)
                        .then(() => {
                          setNotice("Continuing from the transcript.");
                          setReload((value) => value + 1);
                        })
                        .catch((caught: unknown) =>
                          setError(caught instanceof Error ? caught.message : "The run could not be continued."),
                        )
                        .finally(() => setContinuing(false));
                    }}
                  >
                    Continue
                  </Button>
                </div>
              ) : null}
              {job.status === "needs_review" ? (
                <div className="flex flex-wrap gap-2">
                  {["en-US", "de-DE"].map((language) => (
                    <Button
                      key={language}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setNotice("");
                        void rerunJob(job.jobId, language)
                          .then(() => {
                            setNotice(`Rerun started as ${language}.`);
                            setReload((value) => value + 1);
                          })
                          .catch((caught: unknown) =>
                            setError(caught instanceof Error ? caught.message : "The rerun could not be started."),
                          );
                      }}
                    >
                      Use {language}
                    </Button>
                  ))}
                  {(job.detectedLanguages?.length ?? 0) > 1 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setNotice("");
                        void acceptDetected(job.jobId)
                          .then(() => {
                            setNotice("Using both languages from the stored transcript.");
                            setReload((value) => value + 1);
                          })
                          .catch((caught: unknown) =>
                            setError(caught instanceof Error ? caught.message : "The transcript could not be accepted."),
                          );
                      }}
                    >
                      Use both
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {job.videoUrl ? (
                <SubtitleReader
                  videoUrl={job.videoUrl}
                  outputs={job.outputs}
                  jobId={job.jobId}
                  from={place}
                  onExpiredLink={refreshVideo}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </Shell>
  );
}

/** Wraps the job view so the search params can load on the static export. */
export default function JobPage() {
  return (
    <Suspense fallback={<Shell title="Job">Loading.</Shell>}>
      <JobBody />
    </Suspense>
  );
}
