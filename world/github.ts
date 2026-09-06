#!/usr/bin/env bun
// Hookline's GitHub twin as a world service: the REAL twin (`@volter/twin-github`'s own server),
// with the twin's delivery registry wired before anything can write — the registry is an
// in-process object (github-events.ts), and the twin CLI's `serve` never wires it, so the pack's
// own signed X-Hub-Signature-256 pipeline (payload built, HMAC'd and delivered by the pack) is
// dark without this. The hook is `webhook.config.secret` on the twin's repo-webhook endpoint —
// GitHub's own shape for the signing secret. The delivery URL is HOOKLINE_URL (injected by the
// world after the app service started — this service is declared after `app` for that), so the
// inbox's `/in/github` is the hook's destination. Delivery is fire-and-forget in the twin (as on
// GitHub itself); the ledger of what it sent is `GET $GITHUB_TWIN_URL/twin/store/mirror`.
import { createGithubTwinServer, registerGithubWebhook } from '@volter/twin-github';

const url = process.env.HOOKLINE_URL;
if (!url) {
  console.error('world/github.ts: HOOKLINE_URL is required (declare this service after "app")');
  process.exit(2);
}
const port = Number(process.env.PORT);
if (!port) {
  console.error('world/github.ts: PORT is required (the world injects it)');
  process.exit(2);
}
registerGithubWebhook(`${url}/in/github`, process.env.HOOKLINE_GITHUB_WEBHOOK_SECRET);
const server = createGithubTwinServer({ port });
console.log(`github twin (signed repository webhooks) at http://127.0.0.1:${server.port} -> ${url}/in/github`);
await new Promise<void>(() => {});
