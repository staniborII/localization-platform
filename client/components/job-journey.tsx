/**
 * The path one video takes, drawn as a flow and as a stage list.
 * A stage is one stretch of the run, such as waiting for the transcript.
 */

import {
  AudioLines,
  Captions,
  Check,
  Circle,
  Clock,
  FileSearch,
  Flag,
  Mic,
  Save,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { JobStep } from "@/lib/api";
import { cn } from "cn";

const ICONS: Record<string, LucideIcon> = {
  received: Upload,
  checking: FileSearch,
  extracting: AudioLines,
  transcribing: Mic,
  waiting: Clock,
  subtitles: Captions,
  saving: Save,
  finished: Flag,
};

const SHORT: Record<string, string> = {
  received: "Received",
  checking: "Check",
  extracting: "Audio",
  transcribing: "Listen",
  waiting: "Wait",
  subtitles: "Subtitles",
  saving: "Save",
  finished: "Done",
};

const STATE_LABEL: Record<JobStep["state"], string> = {
  done: "Done",
  current: "Now",
  upcoming: "Up next",
  skipped: "Not needed",
  failed: "Stopped",
};

/** Draws the run: a node diagram, then every stage with its sentence. */
export function JobJourney({ steps, status }: { steps: JobStep[]; status: string }) {
  const live = steps.find((step) => step.state === "current") ?? steps.find((step) => step.state === "failed");
  const headline = live ?? [...steps].reverse().find((step) => step.state === "done");
  const activeId = live?.id ?? headline?.id ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Path of this video
          {headline ? <Badge variant={headline.state === "failed" || status === "failed" ? "destructive" : "secondary"}>{headline.title}</Badge> : null}
        </CardTitle>
        <CardDescription>{headline?.detail}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ol className="flex items-start gap-0 overflow-x-auto pb-1" aria-hidden="true">
          {steps.map((step, index) => {
            const Icon = ICONS[step.id] ?? Circle;
            return (
              <li key={step.id} className="flex items-start">
                <div className="flex w-[4.6rem] flex-col items-center gap-1.5 px-1 py-1 text-center">
                  <span className="relative flex size-8 items-center justify-center">
                    {step.state === "current" ? (
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/25" />
                    ) : null}
                    <span className={cn("relative flex size-8 items-center justify-center rounded-full", nodeClass(step.state))}>
                      {step.state === "done" ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                    </span>
                  </span>
                  <span className={cn("text-[11px] leading-tight", step.state === "upcoming" || step.state === "skipped" ? "text-muted-foreground" : "text-foreground")}>
                    {SHORT[step.id] ?? step.title}
                  </span>
                </div>
                {index < steps.length - 1 ? <FlowEdge from={step.state} to={steps[index + 1]?.state ?? "upcoming"} /> : null}
              </li>
            );
          })}
        </ol>
        <ol className="flex flex-col" aria-label="What happened in this run" aria-live="polite">
          {steps.map((step, index) => (
            <StageRow key={step.id} step={step} last={index === steps.length - 1} selected={step.id === activeId} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** One stage in the list, with the sentence for the state it is in. */
function StageRow({ step, last, selected }: { step: JobStep; last: boolean; selected: boolean }) {
  const Icon = ICONS[step.id] ?? Circle;
  return (
    <li
      className="grid grid-cols-[1.75rem_1fr] gap-x-3"
      aria-current={step.state === "current" ? "step" : undefined}
    >
      <div className="flex flex-col items-center">
        <span className={cn("flex size-7 items-center justify-center rounded-full", nodeClass(step.state))}>
          {step.state === "done" ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
        </span>
        {last ? null : <span className={cn("my-1 w-px flex-1", step.state === "failed" ? "bg-destructive/40" : "bg-border")} />}
      </div>
      <div className={cn("mb-3 rounded-lg px-3 py-2", selected && "bg-muted/50", step.state === "upcoming" && "opacity-70")}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{step.title}</p>
          <Badge variant={badgeVariant(step.state)}>{STATE_LABEL[step.state]}</Badge>
          {step.at ? <time className="font-mono text-[11px] text-muted-foreground">{clock(step.at)}</time> : null}
        </div>
        {step.state === "failed" ? (
          <Alert variant="destructive" className="mt-2">
            <AlertTitle>This step stopped the run</AlertTitle>
            <AlertDescription>{step.detail}</AlertDescription>
          </Alert>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
        )}
      </div>
    </li>
  );
}

/** The arrow between two nodes in the flow diagram. */
function FlowEdge({ from, to }: { from: JobStep["state"]; to: JobStep["state"] }) {
  const live = from === "current" || to === "current";
  const quiet = to === "upcoming" || to === "skipped" || from === "skipped";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-4 h-px w-4 shrink-0",
        live && "bg-primary",
        !live && quiet && "bg-border",
        !live && !quiet && "bg-foreground/25",
      )}
    />
  );
}

/** Color of one node from the state of that stage. */
function nodeClass(state: JobStep["state"]): string {
  if (state === "done") {
    return "bg-primary text-primary-foreground";
  }
  if (state === "current") {
    return "bg-background text-primary ring-2 ring-primary";
  }
  if (state === "failed") {
    return "bg-destructive text-white";
  }
  if (state === "skipped") {
    return "border border-dashed border-border bg-transparent text-muted-foreground";
  }
  return "bg-muted text-muted-foreground";
}

/** Badge color for a stage state. */
function badgeVariant(state: JobStep["state"]): "default" | "secondary" | "destructive" | "outline" {
  if (state === "failed") {
    return "destructive";
  }
  if (state === "current") {
    return "default";
  }
  if (state === "done") {
    return "secondary";
  }
  return "outline";
}

/** A short clock time for when a stage was entered. */
function clock(at: string): string {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) {
    return "";
  }
  return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
