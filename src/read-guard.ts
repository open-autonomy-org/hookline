// The read guard: everything that reads or replays the inbox is the owner's to read — the page at
// GET /, the event list and its single events, the target list, target attachment, every replay
// route, and the socket a `hookline listen` target connects with — and the token that opens it is
// `HOOKLINE_READ_TOKEN`, a secret in the Worker's bindings like every other secret (never in the
// inbox's records or its UI, CONSTITUTION.md). A request presents it as
// `Authorization: Bearer <token>`; the socket route also takes `?token=`, for a client that cannot
// set a header on the way out. Two doors stay open to callers that cannot hold a secret: a
// vendor's `POST /in/<source>` — a vendor cannot send one, the signature on its payload is its
// authentication — and `GET /api`, the name-and-version face. A guarded request without a valid
// token is refused 401 with one line that says so and nothing about the inbox's contents; with the
// secret unset every read is refused 503 — the inbox never falls open.

/** The Worker's bindings the read guard reads — one optional secret, and nothing else. */
export interface ReadSecret {
  HOOKLINE_READ_TOKEN?: string;
}

/**
 * The response that refuses a guarded request, or undefined when it may proceed. The secret unset
 * refuses 503 and says so; a missing or wrong token refuses 401. The open doors — a vendor's
 * `POST /in/<source>` and `GET /api` — pass untouched.
 */
export function readGuardFailure(req: Request, env: ReadSecret): Response | undefined {
  const url = new URL(req.url);
  if (isOpenRoute(req.method, url.pathname)) return undefined;
  const secret = env.HOOKLINE_READ_TOKEN;
  if (typeof secret !== 'string' || secret === '') {
    return new Response("the inbox is closed: HOOKLINE_READ_TOKEN is not set in the Worker's bindings, so every read is refused\n", { status: 503 });
  }
  const presented = presentedToken(req, url);
  if (presented === null || !tokensEqual(presented, secret)) {
    return new Response('this read needs the read token: present it as `Authorization: Bearer <HOOKLINE_READ_TOKEN>`\n', {
      status: 401,
      headers: { 'www-authenticate': 'Bearer realm="hookline"' },
    });
  }
  return undefined;
}

/** The routes any caller may use without the token: the vendor doors and the name-and-version face. */
function isOpenRoute(method: string, pathname: string): boolean {
  return (method === 'GET' && (pathname === '/healthz' || pathname === '/api'))
    || (method === 'POST' && pathname.startsWith('/in/'));
}

/** How a request presents the token: `Authorization: Bearer <token>`, or `?token=` on the socket route's GET. */
function presentedToken(req: Request, url: URL): string | null {
  const query = url.searchParams.get('token');
  if (query !== null && query !== '') return query;
  const header = req.headers.get('authorization');
  if (header === null) return null;
  const bearer = /^Bearer\s+(.+)$/i.exec(header.trim());
  return bearer === null ? null : bearer[1].trim();
}

const ENCODER = new TextEncoder();

/**
 * The same bytes, compared in constant time — the way a secret is compared. Unequal lengths refuse
 * at once (the length alone leaks nothing that matters); every byte of equal-length secrets is
 * compared however they differ, the way verify.ts compares every signature.
 */
function tokensEqual(a: string, b: string): boolean {
  const left = ENCODER.encode(a);
  const right = ENCODER.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let at = 0; at < left.length; at += 1) diff |= left[at] ^ right[at];
  return diff === 0;
}
