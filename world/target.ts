#!/usr/bin/env bun
// The app on the other side of the inbox, as a world service: it records every delivery it receives (method, path,
// headers, body) and shows them at GET /received, so a run can read what the inbox forwarded and when.
// It answers 200 unless the path ends in /fail, which answers 500 (a target that is down).
const received: Array<{ at: string; method: string; path: string; headers: Record<string, string>; body: string }> = [];
const port = Number(process.env.PORT);
if (!port) { console.error('world/target.ts: PORT is required (the world injects it)'); process.exit(2); }
Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/healthz') return new Response('ok\n');
    if (url.pathname === '/received' && req.method === 'GET') return Response.json(received);
    const headers: Record<string, string> = {}; req.headers.forEach((v, k) => { headers[k] = v; });
    received.push({ at: new Date().toISOString(), method: req.method, path: url.pathname, headers, body: await req.text() });
    return new Response(url.pathname.endsWith('/fail') ? 'down' : 'ok', { status: url.pathname.endsWith('/fail') ? 500 : 200 });
  },
});
console.log(`target: recording deliveries on :${port}`);
