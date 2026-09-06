// Signature verification: each vendor's own scheme, applied to the exact bytes received, keyed by the
// secret from the Worker's bindings. The verdict and its reason are recorded on the event, and
// verification never blocks storage or delivery — an event that fails is kept and marked (CONSTITUTION.md).
// A scheme is added here when the inbox learns a vendor; a source without one yet is recorded
// unverified and says so.

/** How far a signed request may sit from now, in seconds, and still verify: the tolerance window. */
const TOLERANCE_S = 300;

const ENCODER = new TextEncoder();

/** The verdict recorded on an event: whether it verified, and exactly why or why not. */
export interface Verdict {
  verified: boolean;
  why: string;
}

/** The signing secrets verification reads from the Worker's bindings — never from the inbox's records. */
export interface VerificationSecrets {
  STRIPE_WEBHOOK_SECRET?: string;
}

/** Verify a source's event with that vendor's scheme; a source with no scheme yet records that. */
export async function verifyEvent(source: string, headers: Headers, body: ArrayBuffer, secrets: VerificationSecrets): Promise<Verdict> {
  if (source === 'stripe') return verifyStripe(headers, body, secrets.STRIPE_WEBHOOK_SECRET);
  return { verified: false, why: `no signature scheme is implemented for source ${JSON.stringify(source)} yet` };
}

/**
 * Stripe's scheme: `Stripe-Signature: t=<unix>,v1=<hex>` — v1 is HMAC-SHA256 over `<t>.<body>` keyed by
 * the endpoint's signing secret, and the timestamp must sit within the tolerance window of now. The
 * signed bytes are the request's exact body, byte for byte as received.
 */
export async function verifyStripe(headers: Headers, body: ArrayBuffer, secret: string | undefined, nowS = Math.floor(Date.now() / 1000)): Promise<Verdict> {
  if (typeof secret !== 'string' || secret === '') {
    return { verified: false, why: 'STRIPE_WEBHOOK_SECRET is not set in the Worker\'s bindings' };
  }
  const header = headers.get('stripe-signature');
  if (header === null) return { verified: false, why: 'no Stripe-Signature header' };
  let t = Number.NaN;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') t = Number(value);
    else if (key === 'v1') v1.push(value);
  }
  if (!Number.isInteger(t) || t < 0) {
    return { verified: false, why: `Stripe-Signature has no usable timestamp: ${JSON.stringify(header)}` };
  }
  if (v1.length === 0) {
    return { verified: false, why: `Stripe-Signature carries no v1 signature: ${JSON.stringify(header)}` };
  }
  if (Math.abs(nowS - t) > TOLERANCE_S) {
    return { verified: false, why: `signature timestamp ${t} is ${Math.abs(nowS - t)}s from now, outside the tolerance of ${TOLERANCE_S}s` };
  }
  const expected = await stripeSignature(secret, `${t}.`, new Uint8Array(body));
  for (const candidate of v1) {
    if (constantTimeEquals(candidate, expected)) {
      return { verified: true, why: `v1 HMAC-SHA256 over "t.body" matched; timestamp within ${TOLERANCE_S}s` };
    }
  }
  return { verified: false, why: 'no v1 signature matched the HMAC over "t.body" keyed by STRIPE_WEBHOOK_SECRET' };
}

/** HMAC-SHA256(secret, `${prefix}<body>`) as lowercase hex — Stripe's v1 signature. */
async function stripeSignature(secret: string, prefix: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(ENCODER.encode(prefix), 0);
  signed.set(body, prefix.length);
  const mac = await crypto.subtle.sign('HMAC', key, signed);
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Same length, every character equal — compared in constant time, the way a signature is compared. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let at = 0; at < a.length; at += 1) diff |= a.charCodeAt(at) ^ b.charCodeAt(at);
  return diff === 0;
}
