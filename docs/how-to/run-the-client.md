# Run the client

The web client is a Next.js static export. Pages: upload, jobs, gallery, failures, and one job at `/job?id=`.

## Development

From `client/`:

```bash
npm install
npm run dev
```

Open the URL printed in the terminal. A second `npm run dev` attaches to the server that is already running.

Local `next dev` can show the pages. It has no API. Upload and job status work on the CloudFront hostname after deploy. That hostname is the web client stack output `ConsoleUrl`.

## Production build

```bash
npm run build
```

`output: "export"` writes the site to `client/out`. The build then moves page data files that a Windows export saves in a nested folder onto the flat names the browser requests. Synth packages that folder, and the web client stack uploads it to the site bucket. Build the client before `cdk synth`.
