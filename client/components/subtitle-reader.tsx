/**
 * Plays the uploaded video and lists one language of subtitles underneath.
 * A cue is one subtitle. The line that matches the playhead stays in view.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import type { JobOutput } from "@/lib/api";
import { watchHref, type Section } from "@/lib/navigation";
import { presignExpired } from "@/lib/presign";
import { parseSrt, parseVtt, type SubtitleCue } from "@/lib/vtt";
import { cn } from "cn";

type SubtitleReaderProps = {
  videoUrl: string;
  outputs?: JobOutput[];
  jobId?: string;
  from?: Section;
  lang?: string;
  vttUrl?: string;
  srtUrl?: string;
  file?: "vtt" | "srt";
  onExpiredLink?: () => Promise<string | undefined>;
};

/** Plays the video and keeps the current subtitle in view. */
export function SubtitleReader({
  videoUrl,
  outputs,
  jobId,
  from,
  lang,
  vttUrl,
  srtUrl,
  file = "vtt",
  onExpiredLink,
}: SubtitleReaderProps) {
  const focused = !outputs;
  const readable = outputs?.filter((output) => output.vttUrl || output.srtUrl) ?? [];
  const [selectedLang, setSelectedLang] = useState(lang || readable[0]?.lang || "");
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const renewing = useRef(false);
  const pendingPlay = useRef<number | undefined>(undefined);
  const seenUrl = useRef(videoUrl);
  const [linkNotice, setLinkNotice] = useState("");
  const selected = focused
    ? { lang: lang ?? "", vttUrl, srtUrl }
    : (readable.find((output) => output.lang === selectedLang) ?? readable[0]);
  const useSrt = focused && file === "srt" && Boolean(selected?.srtUrl);
  const sourceUrl = useSrt ? selected?.srtUrl : selected?.vttUrl;

  useEffect(() => {
    if (!sourceUrl) {
      return;
    }
    let stop = false;
    setError("");
    void fetch(sourceUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error("The subtitle file could not be read.");
        }
        return response.text();
      })
      .then((text) => {
        if (!stop) {
          setCues(useSrt ? parseSrt(text) : parseVtt(text));
          setActive(-1);
        }
      })
      .catch((caught: unknown) => {
        if (!stop) {
          setCues([]);
          setError(caught instanceof Error ? caught.message : "The subtitle file could not be read.");
        }
      });
    return () => {
      stop = true;
    };
  }, [sourceUrl, useSrt]);

  useEffect(() => {
    const item = activeRef.current;
    const list = listRef.current;
    if (!item || !list || active < 0) {
      return;
    }
    const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    list.scrollTo({ top: top - list.clientHeight / 2 + item.clientHeight / 2, behavior: "smooth" });
  }, [active]);

  /** Marks the cue that covers the current playback time. */
  function onTimeUpdate() {
    const time = videoRef.current?.currentTime ?? 0;
    const index = cues.findIndex((cue) => time >= cue.startSeconds && time < cue.endSeconds);
    setActive((current) => (current === index ? current : index));
  }

  /** After a fresh link arrives, continues from the time the play click asked for. */
  useEffect(() => {
    if (seenUrl.current === videoUrl) {
      return;
    }
    seenUrl.current = videoUrl;
    const at = pendingPlay.current;
    pendingPlay.current = undefined;
    const video = videoRef.current;
    if (at === undefined || !video) {
      return;
    }
    const resume = () => {
      video.currentTime = at;
      void video.play();
    };
    if (video.readyState >= 1) {
      resume();
      return;
    }
    video.addEventListener("loadedmetadata", resume, { once: true });
  }, [videoUrl]);

  /** Gets a new link when the one on screen has expired, then plays from the same moment. */
  function renewIfExpired(at?: number): boolean {
    if (!onExpiredLink || !presignExpired(videoUrl)) {
      return false;
    }
    videoRef.current?.pause();
    if (renewing.current) {
      return true;
    }
    renewing.current = true;
    const video = videoRef.current;
    pendingPlay.current = at ?? video?.currentTime ?? 0;
    video?.pause();
    setLinkNotice("The video link expired. Getting a new one.");
    void onExpiredLink()
      .then((fresh) => {
        if (!fresh) {
          pendingPlay.current = undefined;
          setError("The video link could not be refreshed.");
        }
      })
      .catch((caught: unknown) => {
        pendingPlay.current = undefined;
        setError(caught instanceof Error ? caught.message : "The video link could not be refreshed.");
      })
      .finally(() => {
        renewing.current = false;
        setLinkNotice("");
      });
    return true;
  }

  return (
    <div className="flex flex-col gap-3">
      <video
        ref={videoRef}
        controls
        className="w-full rounded-lg bg-black"
        src={videoUrl}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => {
          renewIfExpired();
        }}
        onClick={() => {
          renewIfExpired();
        }}
      >
        {selected?.vttUrl ? (
          <track kind="subtitles" srcLang={selected.lang} label={selected.lang} src={selected.vttUrl} default />
        ) : null}
      </video>
      {linkNotice ? <p className="text-sm text-muted-foreground">{linkNotice}</p> : null}
      {!focused && readable.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {readable.map((output) => (
            <Button
              key={output.lang}
              type="button"
              size="sm"
              variant={output.lang === selected?.lang ? "default" : "outline"}
              onClick={() => setSelectedLang(output.lang)}
            >
              {output.lang.toUpperCase()}
            </Button>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {cues.length > 0 ? (
        <ol
          ref={listRef}
          className={cn(
            "flex flex-col gap-2 overflow-y-auto rounded-lg border p-3",
            focused ? "max-h-[60vh]" : "max-h-72",
          )}
        >
          {cues.map((cue, index) => (
            <li
              key={`${cue.start}-${index}`}
              ref={index === active ? activeRef : undefined}
              className={cn("rounded-md px-2 py-1.5 text-sm", index === active ? "bg-muted" : undefined)}
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() => {
                  if (renewIfExpired(cue.startSeconds)) {
                    return;
                  }
                  const video = videoRef.current;
                  if (!video) {
                    return;
                  }
                  video.currentTime = cue.startSeconds;
                  void video.play();
                }}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {cue.start.slice(0, 8)}
                  {cue.speaker ? ` · ${cue.speaker}` : ""}
                </span>
                <span className="mt-0.5 block whitespace-pre-wrap">{cue.text}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {!focused && jobId && outputs && outputs.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {outputs.map((output) => (
            <li key={output.lang} className="flex items-center gap-2">
              <span className="w-8 text-xs font-medium uppercase">{output.lang}</span>
              {output.vttUrl ? (
                <Link
                  className={buttonVariants({ variant: "link", size: "sm" })}
                  href={watchHref(jobId, output.lang, "vtt", from)}
                >
                  WebVTT
                </Link>
              ) : null}
              {output.srtUrl ? (
                <Link
                  className={buttonVariants({ variant: "link", size: "sm" })}
                  href={watchHref(jobId, output.lang, "srt", from)}
                >
                  SRT
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
