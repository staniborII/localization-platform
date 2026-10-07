<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

This app is a static export (`output: "export"`). It is the web client for the localization pipeline: upload, job status, a gallery of succeeded jobs, and failed jobs with reasons. Do not add a Next.js server, route handlers, or Cache Components. The web client calls `/api/uploads` and `/api/jobs` on the same hostname. Job detail reads `?id=` because the job id does not exist at build time. A subtitle page reads `/watch?id=&lang=&format=` for the same reason. `from` names the list the job was opened from, so Back and the filled tab follow that list.
