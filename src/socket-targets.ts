// Socket targets: the wire protocol between the inbox and a laptop attached over a websocket.
// The inbox holds the socket — the laptop connects out to `GET /targets/<name>/socket` and opens
// no port of its own — and delivers one frame at a time, in delivery-id order from the target's
// cursor, holding the queue at each frame until the laptop acknowledges it (stop-and-wait). The
// laptop posts each frame's event to its own local URL exactly as a URL delivery would arrive —
// the same X-Hookline-Original-* and X-Hookline-Event headers, the same raw body bytes — and
// answers ack (its local POST returned 2xx) or nack (anything else). The cursor advances only on
// an ack, so a closed laptop queues events and a reattached one receives what it missed, in
// order, exactly once (CONSTITUTION.md). A nack retries on the socket on the same schedule as
// any target; a frame that was never acknowledged is re-sent when the laptop reattaches. Every
// attempt is recorded on the event: an ack records the status the laptop's local POST returned,
// a nack records the error it reported.
import { deliveryHeaders } from './targets.ts';

/**
 * One frame the inbox delivers down a socket: one event, one attempt, the exact body bytes as
 * base64, and the headers a URL delivery would carry — already prefixed, so the laptop is a
 * dumb pipe and its local target sees the same delivery either way.
 */
export function deliveryFrame(delivery: number, attempt: number, eventId: string, headers: Array<[string, string]>, body: Uint8Array): string {
  return JSON.stringify({ v: 1, delivery, attempt, event: eventId, headers: [...deliveryHeaders({ id: eventId, headers })], body: toBase64(body) });
}

/** What a laptop sends back up the socket: an ack for a frame it delivered locally, or a nack for one it could not. */
export type SocketMessage =
  | { kind: 'ack'; delivery: number; attempt: number; status: number }
  | { kind: 'nack'; delivery: number; attempt: number; status: number | null; error: string };

/** Decode one message from the laptop. The protocol is two messages; anything else fails loudly. */
export function decodeSocketMessage(text: string): SocketMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`a socket message is not JSON: ${JSON.stringify(text.slice(0, 120))}`, { cause });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`a socket message is not an object: ${JSON.stringify(text.slice(0, 120))}`);
  }
  const message = parsed as Record<string, unknown>;
  if (message.v !== 1) throw new Error(`a socket message carries version ${JSON.stringify(message.v)}, not 1`);
  const kind: 'ack' | 'nack' = message.ack !== undefined ? 'ack' : 'nack';
  if (message.nack === undefined && message.ack === undefined) {
    throw new Error(`a socket message is neither an ack nor a nack: ${JSON.stringify(text.slice(0, 120))}`);
  }
  const delivery = message[kind];
  if (!Number.isInteger(delivery) || (delivery as number) < 1) {
    throw new Error(`a socket ${kind} names delivery ${JSON.stringify(delivery)}, not a delivery id`);
  }
  const attempt = message.attempt;
  if (!Number.isInteger(attempt) || (attempt as number) < 1) {
    throw new Error(`a socket ${kind} for delivery ${String(delivery)} carries attempt ${JSON.stringify(attempt)}, not an attempt number`);
  }
  if (kind === 'ack') {
    const status = message.status;
    if (!Number.isInteger(status)) {
      throw new Error(`an ack for delivery ${String(delivery)} carries status ${JSON.stringify(status)}, not the local POST's status`);
    }
    return { kind, delivery: delivery as number, attempt: attempt as number, status: status as number };
  }
  const status = message.status === undefined ? null : message.status;
  if (status !== null && !Number.isInteger(status)) {
    throw new Error(`a nack for delivery ${String(delivery)} carries status ${JSON.stringify(status)}, not a status or null`);
  }
  if (typeof message.error !== 'string' || message.error === '') {
    throw new Error(`a nack for delivery ${String(delivery)} carries no error`);
  }
  return { kind, delivery: delivery as number, attempt: attempt as number, status: status as number | null, error: message.error };
}

/** The exact bytes, as base64 — JSON cannot carry raw bytes without losing them. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}
