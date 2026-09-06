// The Inbox Durable Object: the inbox itself. Every webhook the Worker receives is stored here
// before anything else happens — an id, the source, the time, every request header and the raw
// body byte for byte — and answered 200 with the id. Nothing about the body is parsed or assumed.
// An event is never modified or deleted by this software; it is kept forever in arrival order and
// listed newest first (CONSTITUTION.md).
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './worker.ts';

export class Inbox extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      time TEXT NOT NULL,
      size INTEGER NOT NULL,
      headers TEXT NOT NULL,
      body BLOB NOT NULL
    )`);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname.startsWith('/in/')) {
      return this.receive(this.sourceOf(url.pathname), req);
    }
    if (req.method === 'GET' && url.pathname === '/events') return this.list();
    if (req.method === 'GET' && url.pathname.startsWith('/events/')) {
      return this.show(decodeSegment(url.pathname, '/events/'.length));
    }
    return new Response('not found\n', { status: 404 });
  }

  /** The source is whatever follows /in/, exactly as delivered. */
  private sourceOf(pathname: string): string {
    const source = decodeSegment(pathname, '/in/'.length);
    if (!source) throw new Error('POST /in/ with no source: deliver to POST /in/<source>');
    return source;
  }

  /** Store the event before anything else: id, source, time, every header, the body byte for byte. */
  private async receive(source: string, req: Request): Promise<Response> {
    const body = await req.arrayBuffer();
    const headers = JSON.stringify([...req.headers]);
    const event = { id: `ev_${crypto.randomUUID()}`, source, time: new Date().toISOString(), size: body.byteLength };
    this.sql.exec(
      'INSERT INTO events (id, source, time, size, headers, body) VALUES (?, ?, ?, ?, ?, ?)',
      event.id, event.source, event.time, event.size, headers, body,
    );
    return Response.json({ id: event.id });
  }

  private list(): Response {
    const rows = this.sql.exec('SELECT id, source, time, size FROM events ORDER BY seq DESC').toArray();
    return Response.json(rows.map((row) => ({
      id: row.id as string,
      source: row.source as string,
      time: row.time as string,
      size: row.size as number,
    })));
  }

  private show(id: string): Response {
    const rows = this.sql.exec('SELECT id, source, time, size, headers, body FROM events WHERE id = ?', id).toArray();
    const row = rows[0];
    if (!row) return new Response(`no event ${id}\n`, { status: 404 });
    return Response.json({
      id: row.id as string,
      source: row.source as string,
      time: row.time as string,
      size: row.size as number,
      headers: JSON.parse(row.headers as string) as Array<[string, string]>,
      body: toBase64(new Uint8Array(row.body as ArrayBuffer)),
    });
  }
}

/** A single path segment after `skip` bytes, decoded. A malformed encoding fails loudly. */
function decodeSegment(pathname: string, skip: number): string {
  const raw = pathname.slice(skip);
  try {
    return decodeURIComponent(raw);
  } catch (cause) {
    throw new Error(`${JSON.stringify(raw)} is not a valid URL path segment`, { cause });
  }
}

/** The exact bytes, as base64 — JSON cannot carry raw bytes without losing them. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}
