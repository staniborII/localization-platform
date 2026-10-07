/**
 * Upload form. The profile badge comes from the word after the last underscore in the file name.
 * A file over 5 GB is refused. The same file that was already uploaded opens that job instead of sending the bytes again.
 */

"use client";

import { type FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { FILE_NAME_HINT, profileFromFileName } from "@/lib/file-name";
import { describeProfile } from "@/lib/profiles";
import { requestUpload, type DuplicateUpload, type UploadTicket } from "@/lib/api";
import { jobHref } from "@/lib/navigation";
import { sha256HexOfBlob } from "@/lib/sha256";
import { reasonFromUploadBody } from "@/lib/upload-result";
import { MAX_SINGLE_PUT_BYTES } from "@/lib/upload-limits";
import { Empty } from "./empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

/** True when the presign function found this file already uploaded. */
function isDuplicate(ticket: UploadTicket | DuplicateUpload): ticket is DuplicateUpload {
  return "duplicate" in ticket && ticket.duplicate === true;
}

/** Uses the thrown message, or a connection sentence when the browser could not send the file. */
function failureSentence(caught: unknown): string {
  if (caught instanceof Error && caught.message && caught.message !== "Failed to fetch") {
    return caught.message;
  }
  return "The video could not be sent. Check the connection and try again.";
}

/** Lets the operator pick an MP4, hash it, and PUT it to the presigned URL. */
export function UploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<string | undefined>(undefined);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [existingJobId, setExistingJobId] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<"idle" | "checking" | "uploading">("idle");
  const [error, setError] = useState("");
  const busy = phase !== "idle";
  const tooBig = file !== undefined && file.size > MAX_SINGLE_PUT_BYTES;

  /** Reads the profile token from the chosen file. A file over 5 GB is refused before any hashing. */
  function chooseFile(next: File | undefined) {
    setFile(next);
    setMessage("");
    setExistingJobId(undefined);
    setError("");
    if (!next) {
      setProfile(undefined);
      return;
    }
    if (next.size > MAX_SINGLE_PUT_BYTES) {
      setProfile(undefined);
      setError("This file is larger than 5 GB. One upload can be at most 5 GB.");
      return;
    }
    if (next.size < 1) {
      setProfile(undefined);
      setError("The file is empty.");
      return;
    }
    const token = profileFromFileName(next.name);
    if (!token) {
      setProfile(undefined);
      setError(FILE_NAME_HINT);
      return;
    }
    setProfile(token);
  }

  /** Hashes the file, and either opens the existing job or uploads the bytes. */
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setExistingJobId(undefined);
    setError("");
    if (!file || !profile || file.size < 1 || file.size > MAX_SINGLE_PUT_BYTES) {
      setError(
        file && file.size > MAX_SINGLE_PUT_BYTES
          ? "This file is larger than 5 GB. One upload can be at most 5 GB."
          : FILE_NAME_HINT,
      );
      return;
    }
    setPhase("checking");
    try {
      const sha256 = await sha256HexOfBlob(file);
      const ticket = await requestUpload(file.name, profile, sha256, file.size);
      if (isDuplicate(ticket)) {
        setExistingJobId(ticket.jobId);
        return;
      }
      setPhase("uploading");
      const uploaded = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: file });
      if (!uploaded.ok) {
        throw new Error(reasonFromUploadBody(uploaded.status, await uploaded.text()));
      }
      setMessage("Upload finished. The job appears on the jobs list once the file is in the bucket.");
      setFile(undefined);
      setProfile(undefined);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    } catch (caught) {
      setError(failureSentence(caught));
    } finally {
      setPhase("idle");
    }
  }

  const copy = profile ? describeProfile(profile) : undefined;
  const statusCopy = phase === "checking" ? "Checking this file." : phase === "uploading" ? "Uploading the video." : "";
  const buttonLabel = phase === "checking" ? "Checking this file" : phase === "uploading" ? "Uploading" : "Upload";

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Video</CardTitle>
        <CardDescription>{FILE_NAME_HINT}</CardDescription>
      </CardHeader>
      <form aria-busy={busy} onSubmit={(event) => void onSubmit(event)}>
        <CardContent className="flex flex-col gap-4 pb-4">
          <div className="flex flex-col items-start gap-2">
            <Label htmlFor="video">MP4 file</Label>
            <input
              ref={inputRef}
              id="video"
              type="file"
              accept="video/mp4,.mp4"
              className="sr-only"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
              Choose file
            </Button>
            <p className="w-full break-all text-sm text-muted-foreground">{file?.name ?? "No file chosen"}</p>
          </div>
          {copy && profile ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{copy.label}</Badge>
              <span className="text-sm text-muted-foreground">{copy.detail}</span>
            </div>
          ) : null}
          {busy ? (
            <p className="flex items-center gap-2 text-sm" role="status">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              {statusCopy}
            </p>
          ) : null}
          {existingJobId ? (
            <Empty>
              This video was already uploaded.{" "}
              <Link className="underline underline-offset-4" href={jobHref(existingJobId, "upload")}>
                Open the job
              </Link>
            </Empty>
          ) : null}
          {message ? <Empty>{message}</Empty> : null}
          {error ? <Empty tone="destructive">{error}</Empty> : null}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={busy || !file || !profile || tooBig}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            {buttonLabel}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
