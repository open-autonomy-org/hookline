#!/usr/bin/env bun
// Hookline as a world service: the REAL Worker under `wrangler dev`, on the port the world gives it, its Durable
// Object storage under --persist-to. Nothing in src/ knows it is in a world.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const port = process.env.PORT;
if (!port) { console.error('world/app.ts: PORT is required (the world injects it)'); process.exit(2); }
const persist = arg('--persist-to') ?? resolve('.volter/hookline-state');
const inspector = await (async () => { const s = Bun.serve({ port: 0, fetch: () => new Response('') }); const p = s.port; s.stop(true); return p; })();
const args = ['wrangler', 'dev', '--port', port, '--inspector-port', String(inspector), '--persist-to', persist, '--show-interactive-dev-session', 'false'];
let stopping = false;
let child: ReturnType<typeof spawn> | undefined;
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true', NODE_OPTIONS: '' };
const start = () => {
  child = spawn('bunx', args, { cwd: resolve(import.meta.dir, '..'), stdio: 'inherit', env });
  child.on('exit', (code) => { if (stopping) process.exit(code ?? 0); console.error(`world/app.ts: wrangler dev exited (${code}); restarting on :${port}`); setTimeout(start, 2000); });
};
const stop = () => { stopping = true; child?.kill('SIGTERM'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
start();
