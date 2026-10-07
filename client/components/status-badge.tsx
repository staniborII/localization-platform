/** Maps a job status to a badge color. */

import { Badge } from "@/components/ui/badge";

const variants = {
  completed: "default",
  failed: "destructive",
  needs_review: "secondary",
  empty: "secondary",
  received: "outline",
  running: "outline",
} as const;

/** Shows the status text. An unknown status uses the outline style. */
export function StatusBadge({ status }: { status: string }) {
  const variant = variants[status as keyof typeof variants] ?? "outline";
  return <Badge variant={variant}>{status}</Badge>;
}
