/**
 * One subtitle file. Plays the video and lists that language's lines underneath.
 * The job id and language come from the query, because neither exists at build time.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Empty } from "@/components/empty";
import { Shell } from "@/components/shell";
import { SubtitleReader } from "@/components/subtitle-reader";
import { getJob, type Job } from "@/lib/api";
import { backToJob, backToList, sectionFrom } from "@/lib/navigation";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  de: "German",
  es: "Spanish",
};

/** Loads the job and shows the video with the chosen language. */
function WatchBody() {
  const params = useSearchParams();
  const id = params.get("id");
  const lang = params.get("lang") ?? "";
  const file = params.get("format") === "srt" ? "srt" : "vtt";
  const place = sectionFrom(params.get("from")) ?? "jobs";
  const [job, setJob] = useState<Job | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) {
      return;
    }
    let stop = false;
    void getJob(id)
      .then((result) => {
        if (!stop) {
          setJob(result.job);
        }
      })
      .catch((caught: unknown) => {
        if (!stop) {
          setError(caught instanceof Error ? caught.message : "The job could not be loaded.");
        }
      });
    return () => {
      stop = true;
    };
  }, [id]);

  const languageName = LANGUAGE_NAMES[lang] ?? lang.toUpperCase();
  const formatName = file === "srt" ? "SRT" : "WebVTT";
  const output = job?.outputs.find((item) => item.lang === lang);
  const fileUrl = file === "srt" ? output?.srtUrl : output?.vttUrl;

  if (!id || !lang) {
    return (
      <Shell title="Subtitles" section={place} back={id ? backToJob(id, place) : backToList(place)}>
        <Empty>Open a subtitle file from the job page.</Empty>
      </Shell>
    );
  }

  return (
    <Shell
      title={job?.fileName || "Subtitles"}
      description={`${languageName} ${formatName}`}
      section={place}
      back={backToJob(id, place)}
    >
      {error ? <Empty tone="destructive">{error}</Empty> : null}
      {!error && !job ? <Empty>Loading the video.</Empty> : null}
      {job && !job.videoUrl ? <Empty>The video is not ready yet.</Empty> : null}
      {job && job.videoUrl && !fileUrl ? <Empty>This language has no subtitle file yet.</Empty> : null}
      {job?.videoUrl && fileUrl ? (
        <SubtitleReader
          videoUrl={job.videoUrl}
          vttUrl={output?.vttUrl}
          srtUrl={output?.srtUrl}
          lang={lang}
          file={file}
          onExpiredLink={async () => {
            if (!id) {
              return undefined;
            }
            const result = await getJob(id);
            setJob(result.job);
            return result.job.videoUrl;
          }}
        />
      ) : null}
    </Shell>
  );
}

/** Wraps the watch view so the search params can load on the static export. */
export default function WatchPage() {
  return (
    <Suspense fallback={<Shell title="Subtitles">Loading.</Shell>}>
      <WatchBody />
    </Suspense>
  );
}
