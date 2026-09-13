# Hookline

A self-hosted inbox for webhooks: one stable address your vendors deliver to, every event kept with its exact bytes,
verified, inspectable, replayable to any target — a deployed URL or a laptop connected over a socket, no tunnel to
keep alive. A Cloudflare Worker you deploy in a minute.

## Deploy in a minute

From a fresh clone to your first event, five commands and a vendor. You need [Bun](https://bun.sh) and a Cloudflare
account that has run `wrangler login` once.

```bash
git clone https://github.com/open-autonomy-org/hookline.git && cd hookline
bun install
bunx wrangler deploy --define HOOKLINE_VERSION:"\"$(git rev-parse --short HEAD)\""   # asks to create the Worker the first time
bunx wrangler secret put HOOKLINE_READ_TOKEN                                         # pick a long random string; this is yours, keep it
bunx wrangler secret put STRIPE_WEBHOOK_SECRET                                       # paste the endpoint's signing secret
```

The read token goes in before the first event because every read of the inbox — the page, `GET /events`, the replays,
the socket a `hookline listen` target connects with — is the owner's to read, and the inbox never falls open: until
the token is set it refuses every read with 503 rather than serve without one. A vendor's door stays open —
`POST /in/<source>` needs no token (a vendor cannot send one; the signature on its payload is its authentication),
and `GET /api` answers to anyone. The page asks you for the token once and keeps it in the browser's local storage;
`hookline listen` takes it as `--token` (or `HOOKLINE_READ_TOKEN` in its environment).

The Worker's own address prints at the end of the deploy (`https://hookline.<your-subdomain>.workers.dev`) — that
address is the inbox. Open it in a browser: the page lists the events, each with its signature verdict, its
deliveries per target and a replay button, and says what version it runs.

Point a vendor at the inbox and the first event is on the page and at `GET /events` within seconds. For Stripe, the
endpoint's signing secret is the one shown on the endpoint you create in Stripe's dashboard with
`https://<inbox address>/in/stripe` as its URL; Stripe signs with `Stripe-Signature`, and the inbox verifies it
against the secret you just set. GitHub takes `https://<inbox address>/in/github` (secret with `wrangler secret put
GITHUB_WEBHOOK_SECRET`) and Polar `https://<inbox address>/in/polar` (`wrangler secret put POLAR_WEBHOOK_SECRET`) the
same way — each vendor's signature is checked with its own scheme, the verdict recorded on the event. An event whose
signature does not check is kept and marked, never dropped. No secret is ever shown in the UI or kept in the inbox's
records.

No vendor yet, or you want to see it move before wiring one: open the page and send itself an event with the
"send an event" form (a source without a scheme is recorded `unverified` with the reason — verification never blocks
storage), or from a shell:

```bash
curl -X POST https://<inbox address>/in/stripe -H 'content-type: application/json' -d '{"hello":"world"}'
```

Now attach a target and everything stored is delivered to it:

```bash
curl -X PUT https://<inbox address>/targets/app -H 'content-type: application/json' -d '{"url":"https://your.app/hooks"}'
```

A delivery is the event as a `POST`: the raw body, the original headers under `X-Hookline-Original-`, and
`X-Hookline-Event` naming the event. Any 2xx acknowledges it; anything else is retried — 1s, 5s, 30s, 2m, 10m, then
hourly for a day — and every attempt is recorded on the event. Anything already delivered can be delivered again,
explicitly and recorded as a replay — `POST /events/<id>/replay` with `{"target": <name>}` for one event,
`POST /targets/<name>/replay?from=<event id>` or `?since=<ISO time>` for a range, in order; a replay carries
`X-Hookline-Replay: true` on the wire and shows as `replay: true` on the event's recorded attempts. The page's
replay button calls the same route.

`GET /events` lists the events newest first and `GET /events/<id>` returns one whole — every header, the body, and
every delivery attempt recorded on it.

## How the reference inbox ships

The inbox this project runs for itself deploys from GitHub only: a human cuts a `deploy-v*` tag on a commit they
have read, `.github/workflows/deploy.yml` runs from that tag, and the `production` environment's reviewer approves
it. The environment admits only those tags, so the workflow that holds the Cloudflare token is always the one a
human tagged, never the one on `main`. No machine holds the token, and the agent that builds this project never
sees it: it lands code, and a person decides what goes live.

## A laptop is a target too

Attach it (`PUT /targets/laptop` with `{"url": "hookline-socket:laptop"}`), then run the CLI on the laptop — one
stable outbound websocket, no tunnel, no inbound port:

```bash
bun src/cli.ts listen --inbox ws://localhost:8787 --to http://localhost:3000 --token <read token>
```

The inbox delivers each event down the socket in order; the CLI posts it to the local URL exactly as a URL delivery
would arrive and acknowledges it back — the inbox's cursor advances only on the ack, so a closed laptop queues events
and a reopened one receives what it missed, in order, exactly once. `--target <name>` names the target (default
`laptop`). Against a deployed inbox, the address is its `wss://` form (`wss://hookline.<your-subdomain>.workers.dev`).
The socket is one of the inbox's guarded reads: `--token` carries the read token (or leave it off and set
`HOOKLINE_READ_TOKEN` in the CLI's environment) — without it the inbox refuses the attach.

## Developing here

The repository is worked in the open: `CONSTITUTION.md` says what Hookline is and must remain, the board says what is
next, and `CONTRIBUTING.md` says how code is written here.

```bash
bun install
bun run dev        # the Worker, locally, on http://localhost:8787 — same page, same API
bun run check      # the typecheck, in seconds
```

Secrets under `wrangler dev` come from a `.dev.vars` file (git-ignored), one binding per line
(`HOOKLINE_READ_TOKEN=…`, `STRIPE_WEBHOOK_SECRET=whsec_…`, and the GitHub and Polar ones likewise). Under
`wrangler deploy`, secrets are Worker secrets set with `wrangler secret put`.

[![runway](https://open-autonomy.org/v1/accounts/open-autonomy-org%2Fhookline/runway.svg)](https://open-autonomy.org/open-autonomy-org/hookline)
[![now](https://open-autonomy.org/v1/accounts/open-autonomy-org%2Fhookline/now.svg)](https://open-autonomy.org/open-autonomy-org/hookline)
[![roadmap](https://open-autonomy.org/v1/accounts/open-autonomy-org%2Fhookline/roadmap.svg)](https://open-autonomy.org/open-autonomy-org/hookline)
[![activity](https://open-autonomy.org/v1/accounts/open-autonomy-org%2Fhookline/activity.svg)](https://open-autonomy.org/open-autonomy-org/hookline)

Questions, ideas and bugs go in this repository's issues; the agent's owner files what fits the constitution on the
board, and the board is worked in order.

`world/README.md` is how it is verified: against twins of Stripe, GitHub and Polar, never a real account.
