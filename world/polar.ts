#!/usr/bin/env bun
// Hookline's Polar signer as a world service: the REAL twin (`@volter/twin-polar`'s own server)
// for orders and webhook endpoints, plus — because the Polar twin's own webhook delivery is an
// unimplemented capability (its scorecard lists `webhooks.delivery` as a todo, and the world's
// README says the world signs what Polar would send) — a `/twin/emit` door on the SAME surface.
// POSTing `?order=<id>` there signs and delivers what Polar would send when that order becomes an
// `order.created` event: the real current twin state, Standard Webhooks headers (`webhook-id`,
// `webhook-timestamp`, `webhook-signature: v1,<base64>` HMAC-SHA256 over `id.timestamp.body`,
// the key the spec derives — `whsec_` stripped, the remainder base64-decoded), to every enrolled
// endpoint (the endpoint rows name the destinations). The signing secret is the world's fixture
// value (HOOKLINE_POLAR_WEBHOOK_SECRET — the same value the Worker's POLAR_WEBHOOK_SECRET binding
// holds), so what arrives at the inbox is signed exactly the way Polar signs. The id/timestamp
// ride the response JSON, so an operator can recompute the signature.
import { createHmac } from 'node:crypto';
import { createPolarTwinFetch } from '@volter/twin-polar';

const hookline = process.env.HOOKLINE_URL;
if (!hookline) {
  console.error('world/polar.ts: HOOKLINE_URL is required (declare this service after "app")');
  process.exit(2);
}
const port = Number(process.env.PORT);
if (!port) {
  console.error('world/polar.ts: PORT is required (the world injects it)');
  process.exit(2);
}

const fetchPolar = createPolarTwinFetch({});
const encoder = new TextEncoder();

/** Standard Webhooks' key: `whsec_` stripped, the remainder base64-decoded (the spec's serialization). */
function signingKey(secret: string): Buffer {
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0) throw new Error(`webhook secret ${JSON.stringify(secret.slice(0, 8))}… is not base64`);
  return bytes;
}

/** The v1 signature: base64 of HMAC-SHA256(key, `${id}.${timestamp}.${body}`). */
function v1(key: Buffer, id: string, timestamp: string, body: string): string {
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

const secret = process.env.HOOKLINE_POLAR_WEBHOOK_SECRET;
if (!secret) {
  console.error('world/polar.ts: HOOKLINE_POLAR_WEBHOOK_SECRET is required (the signing secret the world signs with; set the same value as the Worker\'s POLAR_WEBHOOK_SECRET binding)');
  process.exit(2);
}
const key = signingKey(secret);

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/twin/emit') {
      // The subject order must exist in the twin: read it back through the twin's own fetch.
      let order: Record<string, unknown>;
      let endpointRows: Array<Record<string, unknown>>;
      try {
        const orderRes = await fetchPolar(new Request(new URL('/v1/orders/', url.origin), { method: 'GET' }));
        const orders = (await orderRes.json()) as { items?: Array<Record<string, unknown>> };
        const found = (orders.items ?? []).find((o) => o.id === url.searchParams.get('order'));
        if (!found) {
          return Response.json({ error: `no order ${JSON.stringify(url.searchParams.get('order'))} in the twin — create one (POST /v1/checkouts/, POST /v1/checkouts/:id/confirm)` }, { status: 404 });
        }
        order = found;
        const epsRes = await fetchPolar(new Request(new URL('/v1/webhooks/endpoints/', url.origin), { method: 'GET' }));
        const eps = (await epsRes.json()) as { items?: Array<Record<string, unknown>> };
        endpointRows = eps.items ?? [];
      } catch (cause) {
        return Response.json({ error: `reading the twin failed: ${cause instanceof Error ? cause.message : String(cause)}` }, { status: 500 });
      }
      // Polar's payload: `{type, data}` with the event name and the order itself.
      const payload = JSON.stringify({ type: 'order.created', data: order });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const deliveries: Array<{ url: string; id: string; ok: boolean; status?: number; error?: string }> = [];
      for (const ep of endpointRows) {
        const target = typeof ep.url === 'string' ? ep.url : '';
        if (!target) continue;
        const id = `msg_${crypto.randomUUID()}`;
        const signature = `v1,${v1(key, id, timestamp, payload)}`;
        const body = encoder.encode(payload);
        try {
          const res = await fetch(target, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': signature },
            body: body.buffer as ArrayBuffer,
          });
          await res.body?.cancel();
          deliveries.push({ url: target, id, ok: res.ok, status: res.status });
        } catch (cause) {
          deliveries.push({ url: target, id, ok: false, error: cause instanceof Error ? cause.message : String(cause) });
        }
      }
      return Response.json({ type: 'order.created', order: order.id, timestamp, payload, deliveries });
    }
    return fetchPolar(req);
  },
});
console.log(`polar twin (orders + endpoints) with a /twin/emit signer at http://127.0.0.1:${server.port} -> ${hookline}/in/polar`);
await new Promise<void>(() => {});
