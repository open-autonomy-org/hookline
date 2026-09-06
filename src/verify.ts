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
  GITHUB_WEBHOOK_SECRET?: string;
  POLAR_WEBHOOK_SECRET?: string;
}

/** Verify a source's event with that vendor's scheme; a source with no scheme yet records that. */
export async function verifyEvent(source: string, headers: Headers, body: ArrayBuffer, secrets: VerificationSecrets): Promise<Verdict> {
  if (source === 'stripe') return verifyStripe(headers, body, secrets.STRIPE_WEBHOOK_SECRET);
  if (source === 'github') return verifyGithub(headers, body, secrets.GITHUB_WEBHOOK_SECRET);
  if (source === 'polar') return verifyPolar(headers, body, secrets.POLAR_WEBHOOK_SECRET);
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
  const expected = await hmacSha256Hex(secret, `${t}.`, new Uint8Array(body));
  for (const candidate of v1) {
    if (constantTimeEquals(candidate, expected)) {
      return { verified: true, why: `v1 HMAC-SHA256 over "t.body" matched; timestamp within ${TOLERANCE_S}s` };
    }
  }
  return { verified: false, why: 'no v1 signature matched the HMAC over "t.body" keyed by STRIPE_WEBHOOK_SECRET' };
}

/**
 * GitHub's scheme: `X-Hub-Signature-256: sha256=<hex>` — HMAC-SHA256 over the request's exact
 * body, byte for byte as received, keyed by the webhook secret. GitHub sends no timestamp to
 * check, so the check is the signature alone.
 */
export async function verifyGithub(headers: Headers, body: ArrayBuffer, secret: string | undefined): Promise<Verdict> {
  if (typeof secret !== 'string' || secret === '') {
    return { verified: false, why: 'GITHUB_WEBHOOK_SECRET is not set in the Worker\'s bindings' };
  }
  const header = headers.get('x-hub-signature-256');
  if (header === null) return { verified: false, why: 'no X-Hub-Signature-256 header' };
  const eq = header.indexOf('=');
  if (eq === -1 || header.slice(0, eq).trim() !== 'sha256') {
    return { verified: false, why: `X-Hub-Signature-256 is not a sha256= signature: ${JSON.stringify(header)}` };
  }
  const candidate = header.slice(eq + 1).trim();
  const expected = await hmacSha256Hex(secret, '', new Uint8Array(body));
  if (constantTimeEquals(candidate, expected)) {
    return { verified: true, why: 'sha256 HMAC-SHA256 over the body matched, keyed by GITHUB_WEBHOOK_SECRET' };
  }
  return { verified: false, why: 'the sha256 signature does not match the HMAC over the body keyed by GITHUB_WEBHOOK_SECRET' };
}

/**
 * Polar's scheme: Standard Webhooks — `webhook-id`, `webhook-timestamp` and `webhook-signature`
 * headers, the signature `v1,<base64>` where v1 is HMAC-SHA256 over `<id>.<timestamp>.<body>`
 * keyed by the endpoint's secret, and the timestamp must sit within the tolerance window of now.
 * The key is the secret's bytes as Standard Webhooks serializes them: an optional `whsec_` prefix
 * stripped, the remainder base64-decoded (Polar hands out the secret base64-encoded). Several
 * signatures may ride in one header, space- or comma-separated; any one matching verifies.
 */
export async function verifyPolar(headers: Headers, body: ArrayBuffer, secret: string | undefined, nowS = Math.floor(Date.now() / 1000)): Promise<Verdict> {
  if (typeof secret !== 'string' || secret === '') {
    return { verified: false, why: 'POLAR_WEBHOOK_SECRET is not set in the Worker\'s bindings' };
  }
  const id = headers.get('webhook-id');
  if (id === null) return { verified: false, why: 'no webhook-id header' };
  const timestamp = headers.get('webhook-timestamp');
  if (timestamp === null) return { verified: false, why: 'no webhook-timestamp header' };
  const t = Number(timestamp);
  if (!Number.isFinite(t)) {
    return { verified: false, why: `webhook-timestamp is not a number: ${JSON.stringify(timestamp)}` };
  }
  if (Math.abs(nowS - t) > TOLERANCE_S) {
    return { verified: false, why: `webhook-timestamp ${timestamp} is ${Math.abs(nowS - t)}s from now, outside the tolerance of ${TOLERANCE_S}s` };
  }
  const header = headers.get('webhook-signature');
  if (header === null) return { verified: false, why: 'no webhook-signature header' };
  // The header carries `v1,<b64>` entries, space-separated (a leading comma between them also appears in the wild).
  const candidates = header.split(/[\s,]+/).map((part) => part.replace(/^v1,/, '').trim()).filter((part) => part !== '');
  if (candidates.length === 0) {
    return { verified: false, why: `webhook-signature carries no v1 signature: ${JSON.stringify(header)}` };
  }
  let key: Uint8Array;
  try {
    key = standardWebhooksKey(secret);
  } catch (cause) {
    return { verified: false, why: `POLAR_WEBHOOK_SECRET is not a usable Standard Webhooks secret: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const expected = await polarSignature(key, `${id}.${timestamp}.`, new Uint8Array(body));
  for (const candidate of candidates) {
    if (constantTimeEquals(candidate, expected)) {
      return { verified: true, why: `v1 HMAC-SHA256 over "id.timestamp.body" matched; timestamp within ${TOLERANCE_S}s` };
    }
  }
  return { verified: false, why: 'no v1 signature matched the HMAC over "id.timestamp.body" keyed by POLAR_WEBHOOK_SECRET' };
}

/** HMAC-SHA256 over `${prefix}<body>` with a raw-byte key — the Standard Webhooks digest. */
async function hmacSha256Raw(key: Uint8Array, prefix: string, body: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(ENCODER.encode(prefix), 0);
  signed.set(body, prefix.length);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, signed));
}

/** HMAC-SHA256(secret, `${prefix}<body>`) — raw bytes; Standard Webhooks signs base64, Stripe hex. */
async function hmacSha256(secret: string, prefix: string, body: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(ENCODER.encode(prefix), 0);
  signed.set(body, prefix.length);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, signed));
}

/** The Standard Webhooks signature: the HMAC as base64 (standard, unpadded). */
async function polarSignature(key: Uint8Array, prefix: string, body: Uint8Array): Promise<string> {
  const mac = await hmacSha256Raw(key, prefix, body);
  return btoa(String.fromCharCode(...mac));
}

/**
 * The HMAC key for a Standard Webhooks secret, as the spec serializes it: a `whsec_` prefix is
 * stripped (Polar's own secrets arrive without one, base64-encoded) and the remainder is
 * base64-decoded into the key's bytes. A secret with no prefix and no valid base64 fails loudly.
 */
function standardWebhooksKey(secret: string): Uint8Array {
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let binary: string;
  try {
    binary = atob(encoded);
  } catch (cause) {
    throw new Error(`the secret after any whsec_ prefix is not valid base64 (${encoded.length} chars)`, { cause });
  }
  if (binary === '') throw new Error('the secret decodes to zero bytes');
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/** The hex encoding of the HMAC over `${prefix}<body>` — GitHub's and Stripe's encoding of the digest. */
async function hmacSha256Hex(secret: string, prefix: string, body: Uint8Array): Promise<string> {
  const mac = await hmacSha256(secret, prefix, body);
  return [...mac].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Same length, every character equal — compared in constant time, the way a signature is compared. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let at = 0; at < a.length; at += 1) diff |= a.charCodeAt(at) ^ b.charCodeAt(at);
  return diff === 0;
}
