# Synth and deploy

Run these commands from `infra/`.

## Synth

1. Copy the example environment and set your account if you are past the placeholder:

   ```bash
   copy .env.example .env
   ```

2. Install and synthesize. Synth builds the web client when the pages are newer than `client/out`, then packages that folder:

   ```bash
   npm install
   npx cdk synth
   ```

`cdk synth` loads `config.dev.yml` or `config.prod.yml` from `STAGE`. It reads the account and the region from `.env`. With the placeholder account, synth succeeds. It does not deploy. A current export is left as it is. A page change runs `npm run build` in `client/` before the site folder is packaged.

## Deploy

Deploy is local. There is no CI pipeline.

```bash
npx cdk deploy --all
```

Before `cdk deploy`, a hook runs `npx cdk synth` in `infra/`. A failed synth blocks the deploy. A successful synth still asks for confirmation. `cdk destroy` asks for confirmation and does not synth. Replace the placeholder account in `.env` before deploying. The web client stack output `ConsoleUrl` is the hostname. The hook is listed in [Agent tooling](../reference/agent-tooling.md).
