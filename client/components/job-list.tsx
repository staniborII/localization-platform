/**
 * Polls the job list every two seconds and links each row to its detail page.
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listJobs, type Job } from "@/lib/api";
import { jobHref, type Section } from "@/lib/navigation";
import { describeProfile } from "@/lib/profiles";
import { Empty } from "./empty";
import { StatusBadge } from "./status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const POLL_MS = 2000;

/** Shows recent jobs, or only the jobs in one status. */
export function JobList({
  status,
  empty,
  from,
}: {
  status?: string;
  empty: string;
  from: Section;
}) {
  const [jobs, setJobs] = useState<Job[] | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const result = await listJobs(status);
        if (stop) {
          return;
        }
        setJobs(result.jobs);
        setError("");
        if (result.jobs.some((job) => job.status === "received" || job.status === "running")) {
          timer = setTimeout(() => void tick(), POLL_MS);
        }
      } catch (caught) {
        if (!stop) {
          setError(caught instanceof Error ? caught.message : "The job list could not be loaded.");
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
  }, [status]);

  if (error) {
    return <Empty tone="destructive">{error}</Empty>;
  }
  if (!jobs) {
    return <Empty>Loading jobs.</Empty>;
  }
  if (jobs.length === 0) {
    return <Empty>{empty}</Empty>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {jobs.map((job) => {
        const profile = describeProfile(job.profile);
        return (
          <li key={job.jobId}>
            <Card size="sm">
              <CardHeader>
                <CardTitle>
                  <Link href={jobHref(job.jobId, from)} className="underline-offset-4 hover:underline">
                    {job.fileName || job.jobId}
                  </Link>
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{profile.label}</Badge>
                  <StatusBadge status={job.status} />
                  {job.updatedAt ? <span>{job.updatedAt}</span> : null}
                </CardDescription>
              </CardHeader>
              {job.failureReason ? (
                <CardContent>
                  <p className="text-muted-foreground">{job.failureReason}</p>
                </CardContent>
              ) : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
