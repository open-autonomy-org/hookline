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
    // A browser navigation is answered with the one line and the ask, so the page can ask for the
    // token once; every other caller gets the one line alone. The form submits the token as
    // `?token=`, which the guard accepts on a GET — after that the page keeps it in local storage.
    if ((req.headers.get('accept') ?? '').includes('text/html')) {
      return new Response(REFUSAL_HTML, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response(REFUSAL_LINE, {
      status: 401,
      headers: { 'www-authenticate': 'Bearer realm="hookline"' },
    });
  }
  return undefined;
}

const REFUSAL_LINE = 'this read needs the read token: present it as `Authorization: Bearer <HOOKLINE_READ_TOKEN>`\n';

/**
 * The refusal a browser is shown: the one line, a form that asks for the token (submitted as
 * `?token=`), and nothing else — no name, no version, nothing about the inbox's contents. A
 * visitor whose browser already holds the token (the page keeps it in local storage) is taken
 * straight in; one whose token was refused stays here to type the new one. The stored token is
 * not re-tried when it is what was just refused — that would loop.
 */
const REFUSAL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hookline</title>
<style>body { font: 14px/1.5 ui-monospace, Menlo, Consolas, monospace; margin: 2rem auto; max-width: 40rem; padding: 0 1rem; }
form { display: flex; gap: 0.5rem; align-items: baseline; } input { font: inherit; padding: 0.15rem 0.4rem; flex: 1 1 12rem; }</style>
</head>
<body>
<p>this read needs the read token: present it as Authorization: Bearer &lt;your HOOKLINE_READ_TOKEN&gt;</p>
<form method="get" action="">
  <input name="token" type="password" autocomplete="off" autofocus placeholder="HOOKLINE_READ_TOKEN">
  <button type="submit">read the inbox</button>
</form>
<script>
(function () {
  'use strict';
  var stored = null;
  try { stored = window.localStorage.getItem('hookline_read_token'); } catch (e) { /* no storage — the form asks */ }
  var asked = new URLSearchParams(window.location.search).get('token');
  if (stored !== null && stored !== '' && stored !== asked) {
    window.location.replace(window.location.pathname + '?token=' + encodeURIComponent(stored));
  }
})();
</script>
</body>
</html>
`;

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
