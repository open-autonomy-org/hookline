// Hookline: a self-hosted inbox for webhooks, as a Cloudflare Worker. The public address routes to
// the inbox's Durable Object, which receives, keeps and serves every event; this file stays thin —
// its own routes are only the health check.
import { Inbox } from './inbox.ts';

export interface Env {
  INBOX: DurableObjectNamespace<Inbox>;
  /** The vendor signing secrets verification verifies against — set as secrets (`wrangler secret put`, `.dev.vars` in dev). */
  STRIPE_WEBHOOK_SECRET?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  POLAR_WEBHOOK_SECRET?: string;
}

export { Inbox } from './inbox.ts';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/healthz') return new Response('ok\n');
    return env.INBOX.get(env.INBOX.idFromName('default')).fetch(req);
  },
} satisfies ExportedHandler<Env>;
