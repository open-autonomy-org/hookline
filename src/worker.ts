// Hookline: a self-hosted inbox for webhooks, as a Cloudflare Worker. The board builds it one acceptance line at a
// time (hermes/kanban.seed.json); this is the shape it starts from: the Worker answers its health check, and the inbox
// is a Durable Object that keeps nothing yet.
import { DurableObject } from 'cloudflare:workers';

export interface Env { INBOX: DurableObjectNamespace<Inbox> }

export class Inbox extends DurableObject<Env> {
  async fetch(_req: Request): Promise<Response> {
    return new Response('not yet', { status: 404 });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/healthz') return new Response('ok\n');
    return env.INBOX.get(env.INBOX.idFromName('default')).fetch(req);
  },
} satisfies ExportedHandler<Env>;
