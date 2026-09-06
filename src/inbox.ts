// The Inbox Durable Object: the inbox itself. Every webhook the Worker receives is stored here
// before anything else happens — an id, the source, the time, every request header and the raw
// body byte for byte — and answered 200 with the id. Nothing about the body is parsed or assumed.
// An event is never modified or deleted by this software; it is kept forever in arrival order and
// listed newest first (CONSTITUTION.md).
//
// Before it is stored, an event is verified with its vendor's scheme (src/verify.ts) against the
// secrets in the Worker's bindings, and the verdict is recorded with it: `verified` and why. The
// verdict never gates anything — an unverified event is kept, listed and delivered like any other,
// only marked.
//
// Every stored event is delivered to every attached target: one delivery row per (event, target),
// attempted until a 2xx acknowledges it or the retry policy is exhausted, every attempt recorded
// (time, target, status, error). One target's run never waits on another's; the DO's single alarm
// wakes whichever target has work due, and retries keep it driven while work remains.
//
// A replay is an explicit re-delivery, recorded as one: `POST /events/<id>/replay` (a target name
// in the body) and `POST /targets/<name>/replay` (a `?from=<event id>` or `?since=<time>` range)
// queue additional delivery rows flagged `replay`, which ride the same queue as the originals —
// behind them in arrival order — with the same retries and recorded attempts, and reach the target
// marked `X-Hookline-Replay: true`. The originals are replay 0; a replay is never one of them.
import { DurableObject } from 'cloudflare:workers';
import { nextDelayS, deliveryRequest, type Target } from './targets.ts';
import { verifyEvent, type Verdict } from './verify.ts';
import type { Env } from './worker.ts';

/** No attempt is scheduled at or before this: the queue's floor is "now" (an alarm at 0 is an error). */
const MS_FLOOR = 1;

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
      body BLOB NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      verified_why TEXT NOT NULL DEFAULT ''
    )`);
    // An inbox born before the verdict columns existed is migrated in place, once: the ALTERs
    // above only run where the columns are missing (SQLite throws on a duplicate column).
    const columns = new Set(this.sql.exec('PRAGMA table_info(events)').toArray().map((row) => String(row.name)));
    if (!columns.has('verified')) this.sql.exec('ALTER TABLE events ADD COLUMN verified INTEGER NOT NULL DEFAULT 0');
    if (!columns.has('verified_why')) this.sql.exec(`ALTER TABLE events ADD COLUMN verified_why TEXT NOT NULL DEFAULT ''`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS targets (
      name TEXT PRIMARY KEY,
      url TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL REFERENCES events(id),
      target TEXT NOT NULL REFERENCES targets(name),
      next_attempt_s INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      replay INTEGER NOT NULL DEFAULT 0,
      UNIQUE (event_id, target, replay)
    )`);
    // A table born before replays existed carries UNIQUE (event_id, target), which would silently
    // swallow a replay row whose event and target already have an original delivery. It is rebuilt
    // in place, once, with the replay column and the three-way key.
    const deliveryColumns = new Set(this.sql.exec('PRAGMA table_info(deliveries)').toArray().map((row) => String(row.name)));
    if (!deliveryColumns.has('replay')) {
      this.sql.exec(`CREATE TABLE deliveries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL REFERENCES events(id),
        target TEXT NOT NULL REFERENCES targets(name),
        next_attempt_s INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        replay INTEGER NOT NULL DEFAULT 0,
        UNIQUE (event_id, target, replay)
      )`);
      this.sql.exec(`INSERT INTO deliveries_new (id, event_id, target, next_attempt_s, attempts, done, replay)
        SELECT id, event_id, target, next_attempt_s, attempts, done, 0 FROM deliveries`);
      this.sql.exec('DROP TABLE deliveries');
      this.sql.exec('ALTER TABLE deliveries_new RENAME TO deliveries');
      this.sql.exec('CREATE INDEX IF NOT EXISTS deliveries_by_next ON deliveries (next_attempt_s)');
    }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS attempts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
      target TEXT NOT NULL,
      time TEXT NOT NULL,
      status INTEGER,
      error TEXT
    )`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS deliveries_by_next ON deliveries (next_attempt_s)');
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (req.method === 'POST' && url.pathname.startsWith('/in/')) {
        return await this.receive(this.sourceOf(url.pathname), req);
      }
      if (req.method === 'GET' && url.pathname === '/events') return this.list();
      if (req.method === 'GET' && url.pathname.startsWith('/events/')) {
        return await this.show(decodeSegment(url.pathname, '/events/'.length));
      }
      if (req.method === 'PUT' && url.pathname.startsWith('/targets/')) {
        return await this.attach(decodeSegment(url.pathname, '/targets/'.length), req);
      }
      if (req.method === 'GET' && url.pathname === '/targets') return Response.json(this.targets());
      if (req.method === 'POST' && url.pathname.startsWith('/events/')) {
        const rest = url.pathname.slice('/events/'.length);
        const slash = rest.lastIndexOf('/');
        if (slash !== -1 && rest.slice(slash + 1) === 'replay') {
          return await this.replayEvent(decodeSegment(rest.slice(0, slash)), req);
        }
        return await this.show(decodeSegment(rest));
      }
      if (req.method === 'POST' && url.pathname.startsWith('/targets/')) {
        const rest = url.pathname.slice('/targets/'.length);
        const slash = rest.lastIndexOf('/');
        if (slash !== -1 && rest.slice(slash + 1) === 'replay') {
          const from = url.searchParams.get('from');
          const since = url.searchParams.get('since');
          if ((from === null) === (since === null)) {
            throw new Error(`POST /targets/${decodeSegment(rest.slice(0, slash))}/replay wants exactly one range: ?from=<event id> or ?since=<ISO time>`);
          }
          return await this.replayRange(decodeSegment(rest.slice(0, slash)), from, since);
        }
      }
      return new Response('not found\n', { status: 404 });
    } catch (cause) {
      return new Response(`${cause instanceof Error ? cause.message : String(cause)}\n`, { status: 400 });
    }
  }

  /** The source is whatever follows /in/, exactly as delivered. */
  private sourceOf(pathname: string): string {
    const source = decodeSegment(pathname, '/in/'.length);
    if (!source) throw new Error('POST /in/ with no source: deliver to POST /in/<source>');
    return source;
  }

  /**
   * Store the event before anything else: id, source, time, every header, the body byte for byte.
   * The signature verdict rides along: verified with the vendor's own scheme against the bindings'
   * secret, recorded as `verified` and why — and never allowed to block storage.
   */
  private async receive(source: string, req: Request): Promise<Response> {
    const body = await req.arrayBuffer();
    const headers = JSON.stringify([...req.headers]);
    const event = { id: `ev_${crypto.randomUUID()}`, source, time: new Date().toISOString(), size: body.byteLength };
    let verdict: Verdict;
    try {
      verdict = await verifyEvent(source, req.headers, body, this.env);
    } catch (cause) {
      verdict = { verified: false, why: `verification failed to run: ${cause instanceof Error ? cause.message : String(cause)}` };
    }
    this.sql.exec(
      'INSERT INTO events (id, source, time, size, headers, body, verified, verified_why) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      event.id, event.source, event.time, event.size, headers, body, verdict.verified ? 1 : 0, verdict.why,
    );
    this.enqueueAll();
    await this.wake();
    return Response.json({ id: event.id, verified: verdict.verified, verified_why: verdict.why });
  }

  /**
   * Queue every stored event for every attached target, where not already queued. One idempotent
   * statement is the queue's single point of truth: receive, attach and the alarm all call it, so
   * an event is never left stranded because a driver died between storing and enqueueing.
   */
  private enqueueAll(): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO deliveries (event_id, target, next_attempt_s, attempts, done)
       SELECT events.id, targets.name, 0, 0, 0 FROM events CROSS JOIN targets`,
    );
  }

  private list(): Response {
    const rows = this.sql.exec('SELECT id, source, time, size, verified FROM events ORDER BY seq DESC').toArray();
    return Response.json(rows.map((row) => ({
      id: row.id as string,
      source: row.source as string,
      time: row.time as string,
      size: row.size as number,
      verified: row.verified === 1,
    })));
  }

  private show(id: string): Response {
    const rows = this.sql.exec(
      `SELECT id, source, time, size, headers, body, verified, verified_why FROM events WHERE id = ?`, id,
    ).toArray();
    const row = rows[0];
    if (!row) return new Response(`no event ${id}\n`, { status: 404 });
    return Response.json({
      id: row.id as string,
      source: row.source as string,
      time: row.time as string,
      size: row.size as number,
      verified: row.verified === 1,
      verified_why: row.verified_why as string,
      headers: JSON.parse(row.headers as string) as Array<[string, string]>,
      body: toBase64(new Uint8Array(row.body as ArrayBuffer)),
      attempts: this.sql.exec(
        `SELECT attempts.target, attempts.time, attempts.status, attempts.error, deliveries.replay
         FROM attempts JOIN deliveries ON deliveries.id = attempts.delivery_id
         WHERE deliveries.event_id = ? ORDER BY attempts.seq`,
        id,
      ).toArray().map((attempt) => ({
        target: attempt.target as string,
        time: attempt.time as string,
        status: attempt.status === null ? null : attempt.status as number,
        error: attempt.error === null ? null : attempt.error as string,
        replay: Number(attempt.replay) > 0,
      })),
    });
  }

  /**
   * Attach a target by name with the URL its deliveries go to. Enqueues every stored event not yet
   * enqueued for it and wakes the queue: attaching a target delivers the inbox's whole backlog.
   */
  private async attach(name: string, req: Request): Promise<Response> {
    if (!name) throw new Error('PUT /targets/ with no name: attach with PUT /targets/<name>');
    if (req.headers.get('content-type') !== 'application/json') {
      throw new Error(`PUT /targets/${name} wants a JSON body ({"url": ...}), got content-type ${JSON.stringify(req.headers.get('content-type'))}`);
    }
    const body = (await req.json()) as { url?: unknown };
    const url = body.url;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error(`PUT /targets/${name}: url must be an http(s) URL, got ${JSON.stringify(url)}`);
    }
    this.sql.exec(
      'INSERT INTO targets (name, url) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET url = excluded.url',
      name, url,
    );
    this.enqueueAll();
    await this.wake();
    return Response.json({ name, url, targets: this.targets() });
  }

  private targets(): Target[] {
    return this.sql.exec('SELECT name, url FROM targets ORDER BY name').toArray().map((row) => ({
      name: row.name as string,
      url: row.url as string,
    }));
  }

  /**
   * Replay one event to one target: a target name in the body. The replay is an additional
   * delivery row flagged `replay`, distinct from the original, riding the queue behind it.
   */
  private async replayEvent(id: string, req: Request): Promise<Response> {
    if (req.headers.get('content-type') !== 'application/json') {
      throw new Error(`POST /events/${id}/replay wants a JSON body ({"target": ...}), got content-type ${JSON.stringify(req.headers.get('content-type'))}`);
    }
    const body = (await req.json()) as { target?: unknown };
    if (typeof body.target !== 'string' || body.target === '') {
      throw new Error(`POST /events/${id}/replay: target must be the name of an attached target, got ${JSON.stringify(body.target)}`);
    }
    return this.replay([id], body.target);
  }

  /**
   * Replay a range of events to one target, in order: `?from=<event id>` is that event and
   * everything after it; `?since=<ISO time>` is everything stored at or after the time. Both
   * resolve against arrival order (seq), so the replays reach the target in order.
   */
  private async replayRange(name: string, from: string | null, since: string | null): Promise<Response> {
    if (since !== null) {
      const when = Date.parse(since);
      if (Number.isNaN(when)) throw new Error(`POST /targets/${name}/replay: since must be an ISO time, got ${JSON.stringify(since)}`);
      const rows = this.sql.exec('SELECT id FROM events WHERE time >= ? ORDER BY seq', new Date(when).toISOString()).toArray();
      return this.replay(rows.map((row) => String(row.id)), name);
    }
    const rows = this.sql.exec('SELECT seq FROM events WHERE id = ?', from).toArray();
    if (rows.length === 0) throw new Error(`POST /targets/${name}/replay: no event ${JSON.stringify(from)} in the inbox`);
    const seq = Number(rows[0].seq);
    const rest = this.sql.exec('SELECT id FROM events WHERE seq >= ? ORDER BY seq', seq).toArray();
    return this.replay(rest.map((row) => String(row.id)), name);
  }

  /**
   * Queue the named events to the target as replays — additional delivery rows, distinct from the
   * originals and recorded as what they are. Replays are batched: an event's first replay request
   * queues batch 1, and a request after a batch has finished queues the next batch — asking again
   * delivers again. A request while a batch is still in flight re-uses it, so two callers asking
   * at once do not double-deliver. `queued` counts the rows newly written.
   */
  private async replay(ids: string[], name: string): Promise<Response> {
    const target = this.targets().find((candidate) => candidate.name === name);
    if (!target) {
      throw new Error(`replay to ${JSON.stringify(name)}: no target with that name is attached (attach it with PUT /targets/${name})`);
    }
    for (const id of ids) {
      const exists = this.sql.exec('SELECT 1 AS ok FROM events WHERE id = ?', id).toArray();
      if (exists.length === 0) throw new Error(`replay to ${JSON.stringify(name)}: no event ${JSON.stringify(id)} in the inbox`);
    }
    let queued = 0;
    for (const id of ids) {
      const before = this.countReplays(id, name);
      this.sql.exec(
        `INSERT INTO deliveries (event_id, target, next_attempt_s, attempts, done, replay)
         SELECT ?, ?, 0, 0, 0,
           CASE WHEN EXISTS (SELECT 1 FROM deliveries d WHERE d.event_id = ? AND d.target = ? AND d.replay > 0 AND d.done = 0)
                THEN (SELECT MAX(replay) FROM deliveries d2 WHERE d2.event_id = ? AND d2.target = ?)
                ELSE COALESCE((SELECT MAX(replay) FROM deliveries d3 WHERE d3.event_id = ? AND d3.target = ?), 0) + 1 END
         WHERE EXISTS (SELECT 1 FROM events WHERE id = ?)
         ON CONFLICT (event_id, target, replay) DO NOTHING`,
        id, name, id, name, id, name, id, name, id,
      );
      queued += this.countReplays(id, name) - before;
    }
    await this.wake();
    return Response.json({ target: name, queued });
  }

  /** How many replay deliveries an event already has queued or finished for a target. */
  private countReplays(id: string, name: string): number {
    return Number(this.sql.exec(
      'SELECT count(*) AS n FROM deliveries WHERE event_id = ? AND target = ? AND replay > 0', id, name,
    ).toArray()[0].n);
  }

  /** Run everything due for one target now; another target's run never waits on it. */
  private async run(targetName: string): Promise<void> {
    if (this.running.has(targetName)) return;
    this.running.add(targetName);
    try {
      for (;;) {
        const due = this.sql.exec(
          'SELECT id, event_id, attempts, replay FROM deliveries WHERE target = ? AND done = 0 AND next_attempt_s >= 0 AND next_attempt_s <= ? ORDER BY next_attempt_s, id LIMIT 1',
          targetName, Date.now(),
        ).toArray()[0];
        if (!due) break;
        await this.attempt(String(due.id), String(due.event_id), targetName, Number(due.attempts), Number(due.replay) > 0);
      }
    } finally {
      this.running.delete(targetName);
    }
  }

  /** One delivery attempt against the target URL; records it either way and reschedules or finishes. */
  private async attempt(deliveryId: string, eventId: string, targetName: string, attemptsMade: number, replay: boolean): Promise<void> {
    const target = this.targets().find((candidate) => candidate.name === targetName);
    if (!target) throw new Error(`delivery ${deliveryId} names target ${JSON.stringify(targetName)} but no target with that name is attached`);
    const rows = this.sql.exec('SELECT headers, body FROM events WHERE id = ?', eventId).toArray();
    const event = rows[0];
    if (!event) throw new Error(`delivery ${deliveryId} names event ${eventId} but the inbox holds no such event`);
    const headers = JSON.parse(event.headers as string) as Array<[string, string]>;
    const body = new Uint8Array(event.body as ArrayBuffer);
    const time = new Date().toISOString();
    let status: number | null = null;
    let error: string | null = null;
    try {
      const response = await fetch(deliveryRequest(target, { id: eventId, headers, replay }, body));
      status = response.status;
      if (!(status >= 200 && status < 300)) error = `not acknowledged: status ${status}`;
      await response.body?.cancel();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    this.sql.exec(
      'INSERT INTO attempts (delivery_id, target, time, status, error) VALUES (?, ?, ?, ?, ?)',
      Number(deliveryId), targetName, time, status, error,
    );
    const attempts = attemptsMade + 1;
    if (error === null) {
      this.sql.exec('UPDATE deliveries SET attempts = ?, done = 1 WHERE id = ?', attempts, Number(deliveryId));
      return;
    }
    const delayS = nextDelayS(attempts);
    if (delayS === undefined) {
      this.sql.exec('UPDATE deliveries SET attempts = ?, next_attempt_s = -1 WHERE id = ?', attempts, Number(deliveryId));
      return;
    }
    this.sql.exec('UPDATE deliveries SET attempts = ?, next_attempt_s = ? WHERE id = ?', attempts, Date.now() + delayS * 1000, Number(deliveryId));
  }

  /** Keep the queues driven: an alarm at the next attempt due on any target, if any attempt is pending. */
  private async wake(): Promise<void> {
    const rows = this.sql.exec(
      'SELECT MIN(next_attempt_s) AS next_s FROM deliveries WHERE done = 0 AND next_attempt_s >= 0',
    ).toArray();
    const nextS = rows[0]?.next_s === null || rows[0]?.next_s === undefined ? null : Number(rows[0].next_s);
    if (nextS === null) {
      if ((await this.ctx.storage.getAlarm()) !== null) await this.ctx.storage.deleteAlarm();
      return;
    }
    const nextMs = nextS > MS_FLOOR ? nextS : MS_FLOOR;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > nextMs) await this.ctx.storage.setAlarm(nextMs);
  }

  /** The alarm wakes every target with work due; the queues re-arm whatever remains. */
  async alarm(): Promise<void> {
    this.enqueueAll();
    const due = this.sql.exec(
      'SELECT DISTINCT target FROM deliveries WHERE done = 0 AND next_attempt_s >= 0 AND next_attempt_s <= ?',
      Date.now(),
    ).toArray().map((row) => row.target as string);
    for (const targetName of due) await this.run(targetName);
    await this.wake();
  }

  /** Guard against two runs of one target interleaving (an alarm and an attach waking it at once). */
  private readonly running = new Set<string>();
}

/** A single path segment after `skip` bytes, decoded. A malformed encoding fails loudly. */
function decodeSegment(pathname: string, skip = 0): string {
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
