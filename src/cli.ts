#!/usr/bin/env bun
// Hookline's CLI: the laptop side of the inbox. `listen` connects OUT to the inbox over a
// websocket — one stable outbound connection, no tunnel, no inbound port on the laptop — and
// attaches as a named socket target. The inbox delivers events down the socket in order from the
// target's cursor, stop-and-wait, holding its queue at each frame until this process answers;
// each frame is POSTed to the local URL exactly as a URL delivery would arrive — the same
// X-Hookline-Original-* and X-Hookline-Event headers, the raw body byte for byte — and
// acknowledged up the socket: ack when the local POST answers 2xx (the inbox's cursor advances
// only then), nack with the status or error when it does not, which the inbox retries on the
// socket on its usual schedule. The socket dropping loses nothing: unacknowledged work stays the
// inbox's pending frame and is re-sent when the laptop reattaches — the same delivery and cursor —
// so a closed laptop queues events and a reopened one receives what it missed, in order, exactly
// once. The wire protocol lives in src/socket-targets.ts; this file is the laptop's half of it.
const RECONNECT_MS = 1000;

interface Args {
  inbox: string;
  to: string;
  target: string;
}

/** Parse `listen --inbox <url> --to <url> [--target <name>]`. Anything else fails loudly. */
export function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  if (command !== 'listen') {
    throw new Error(`usage: bun src/cli.ts listen --inbox <inbox url> --to <local url> [--target <name>] (got ${JSON.stringify(argv.join(' '))})`);
  }
  let inbox: string | undefined;
  let to: string | undefined;
  let target: string | undefined;
  for (let at = 0; at < rest.length; at += 2) {
    const flag = rest[at];
    const value = rest[at + 1];
    if (value === undefined) throw new Error(`${flag} wants a value`);
    if (flag === '--inbox') inbox = value;
    else if (flag === '--to') to = value;
    else if (flag === '--target') target = value;
    else throw new Error(`unknown flag ${JSON.stringify(flag)}: listen takes --inbox, --to and --target`);
  }
  if (inbox === undefined || !/^wss?:\/\//.test(inbox)) {
    throw new Error(`listen wants --inbox <inbox url>, a ws:// or wss:// URL (got ${JSON.stringify(inbox)})`);
  }
  if (to === undefined || !/^https?:\/\//.test(to)) {
    throw new Error(`listen wants --to <local url>, an http:// or https:// URL (got ${JSON.stringify(to)})`);
  }
  return { inbox, to, target: target ?? 'laptop' };
}

/** Attach to the inbox as a named socket target and deliver its frames to the local URL, forever. */
function listen(args: Args): void {
  console.error(`hookline listen: target ${JSON.stringify(args.target)} -> ${args.to}, inbox ${args.inbox}`);
  let socket: WebSocket | undefined;
  // The one frame the inbox is holding: set when it arrives, cleared when its ack is sent, when a
  // retry is scheduled, or when the socket drops. Stop-and-wait — until it is cleared, the inbox
  // sends nothing else.
  let pending: { delivery: number; attempt: number } | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;

  const attach = (): void => {
    const ws = new WebSocket(`${args.inbox}/targets/${encodeURIComponent(args.target)}/socket`);
    socket = ws;
    ws.onopen = () => {
      if (reconnect !== undefined) clearTimeout(reconnect);
      reconnect = undefined;
      console.error(`hookline listen: attached as ${JSON.stringify(args.target)}`);
    };
    ws.onmessage = (message) => {
      if (typeof message.data !== 'string') {
        console.error(`hookline listen: a frame is not text — ignoring ${typeof message.data}`);
        return;
      }
      void deliverFrame(message.data);
    };
    ws.onclose = () => {
      if (socket === ws) socket = undefined;
      pending = undefined;
      console.error(`hookline listen: the socket closed; reconnecting in ${RECONNECT_MS}ms`);
      if (reconnect === undefined) reconnect = setTimeout(attach, RECONNECT_MS);
    };
    ws.onerror = () => {
      console.error(`hookline listen: the socket errored`);
    };
  };

  /**
   * One frame from the inbox: POST it to the local URL exactly as a URL delivery would arrive,
   * then answer ack (2xx — the cursor advances) or nack (anything else — the inbox retries on
   * its usual schedule). The socket dropping mid-delivery loses nothing: the frame stays the
   * inbox's pending frame and is re-sent when the laptop reattaches.
   */
  const deliverFrame = async (frame: string): Promise<void> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame);
    } catch (cause) {
      throw new Error(`a frame is not JSON: ${JSON.stringify(frame.slice(0, 120))}`, { cause });
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`a frame is not an object: ${JSON.stringify(frame.slice(0, 120))}`);
    }
    const f = parsed as { delivery?: unknown; attempt?: unknown; event?: unknown; headers?: unknown; body?: unknown };
    const delivery = f.delivery;
    const attempt = f.attempt;
    const event = f.event;
    if (!Number.isInteger(delivery) || !Number.isInteger(attempt) || typeof event !== 'string' || !Array.isArray(f.headers) || typeof f.body !== 'string') {
      throw new Error(`a frame is malformed: ${JSON.stringify(frame.slice(0, 120))}`);
    }
    pending = { delivery: delivery as number, attempt: attempt as number };
    let body: Uint8Array<ArrayBuffer>;
    try {
      body = Uint8Array.from(atob(f.body), (character) => character.charCodeAt(0));
    } catch (cause) {
      throw new Error(`frame ${String(delivery)} for ${event} carries a body that is not base64`, { cause });
    }
    let status: number | null = null;
    let error: string | undefined;
    try {
      const response = await fetch(args.to, { method: 'POST', headers: f.headers as Array<[string, string]>, body });
      status = response.status;
      await response.body?.cancel();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const acknowledged = error === undefined && status !== null && status >= 200 && status < 300;
    const answer = acknowledged
      ? { v: 1, ack: delivery, attempt, status }
      : { v: 1, nack: delivery, attempt, status, error: error ?? `not acknowledged: status ${String(status)}` };
    if (socket?.readyState !== WebSocket.OPEN) {
      console.error(`hookline listen: the socket closed before ${event} could be answered; the inbox will re-send it`);
      pending = undefined;
      return;
    }
    socket.send(JSON.stringify(answer));
    if (acknowledged) {
      console.error(`hookline listen: ${event} delivered (status ${String(status)})`);
      pending = undefined;
    } else {
      console.error(`hookline listen: ${event} not delivered (status ${String(status)}, ${answer.error}) — the inbox will send it again`);
      pending = undefined;
    }
  };

  const shutdown = (): void => {
    console.error(`hookline listen: closing`);
    if (reconnect !== undefined) clearTimeout(reconnect);
    socket?.close(1000, 'shutting down');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  attach();
}

const [command] = process.argv.slice(2);
if (command === 'listen') {
  try {
    listen(parseArgs(process.argv.slice(2)));
  } catch (cause) {
    console.error(`hookline listen: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(2);
  }
} else {
  console.error(`usage: bun src/cli.ts listen --inbox <inbox url> --to <local url> [--target <name>]`);
  process.exit(2);
}
