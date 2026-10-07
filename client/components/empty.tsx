/** A short notice used when a list is empty or a request failed. */

import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Renders the message. A destructive tone is used for errors. */
export function Empty({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "destructive" }) {
  return (
    <Alert variant={tone === "destructive" ? "destructive" : "default"}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
