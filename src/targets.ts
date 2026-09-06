// Targets and their deliveries: what the inbox forwards an event as, and how a failed attempt is retried.
// A delivery is acknowledged by any 2xx; anything else — a non-2xx, a network error, a timeout — is retried on
// the schedule below, hourly for a day, then dropped (the event itself is never deleted, CONSTITUTION.md).

/** A target the inbox forwards to: a name, and the URL every stored event is POSTed to. */
export interface Target { name: string; url: string }

/** How long to wait before the next attempt: 1s, 5s, 30s, 2m, 10m, then hourly — 24 hourly waits, a day. */
const FAST_S = [1, 5, 30, 120, 600] as const;
const DAY_OF_HOURLY_WAITS = 24;
export const RETRY_DELAYS_S: readonly number[] = [...FAST_S, ...Array<number>(DAY_OF_HOURLY_WAITS).fill(3600)];

/** The delivery considered abandoned after this many attempts (five fast waits plus a day of hourly ones). */
export const MAX_ATTEMPTS = RETRY_DELAYS_S.length;

/** Backoff before attempt n (1-based), in seconds; undefined when the policy is exhausted. */
export function nextDelayS(attemptsMade: number): number | undefined {
  return RETRY_DELAYS_S[attemptsMade - 1];
}

/**
 * The POST the inbox makes to a target: the raw body byte for byte, the original headers prefixed
 * `X-Hookline-Original-`, and `X-Hookline-Event` naming the event. Everything that would overwrite what the
 * delivery itself needs (host, content-length) is left to fetch.
 */
export function deliveryRequest(target: Target, event: { id: string; headers: Array<[string, string]> }, body: Uint8Array): Request {
  const headers = new Headers();
  for (const [name, value] of event.headers) headers.append(`X-Hookline-Original-${name}`, value);
  headers.set('X-Hookline-Event', event.id);
  return new Request(target.url, { method: 'POST', body: bytesView(body), headers });
}

/** A Uint8Array view over the stored BLOB — Request needs a view, not an ArrayBuffer, to keep the exact length. */
function bytesView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes as Uint8Array<ArrayBuffer>;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
