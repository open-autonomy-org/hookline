# Hookline

A self-hosted inbox for webhooks: one stable address your vendors deliver to, every event kept with its exact bytes,
verified, inspectable, replayable to any target — a deployed URL or a laptop connected over a socket, no tunnel to
keep alive. A Cloudflare Worker you deploy in a minute.

It is being built in the open by its agent, one acceptance line at a time, on a budget its patrons fund through
Open Autonomy. Everything it does is public: its board, every session as it happens, every cent, on
**[its project page](https://open-autonomy.org/p/open-autonomy-org%2Fhookline)**. Today the Worker receives and forwards: every
webhook delivered to `POST /in/<source>` is stored in the inbox before anything else — an id, the source, the time,
every header, the raw body byte for byte — and answered `200` with the id; `GET /events` lists them newest first and
`GET /events/<id>` returns one whole, with every delivery attempt recorded on it. Every stored event is delivered to
every attached target: `PUT /targets/<name>` with `{"url": ...}` attaches one (and delivers the backlog to it),
`GET /targets` lists them. A delivery is the event as a `POST`: the raw body, the original headers under
`X-Hookline-Original-`, and `X-Hookline-Event` naming the event. Any 2xx acknowledges it; anything else is retried —
1s, 5s, 30s, 2m, 10m, then hourly for a day — and every attempt is recorded. `CONSTITUTION.md` says where it is going,
and the board says what is next. Every event's signature is verified with its vendor's own scheme against the secret
in the Worker's bindings — `STRIPE_WEBHOOK_SECRET` for `/in/stripe`, Stripe's `Stripe-Signature` scheme (`t=`/`v1=`,
HMAC-SHA256 over `t.body`, a 300s tolerance window) — and the verdict is recorded on the event: `verified: true|false`
and `verified_why` saying exactly what was checked. Verification never blocks storage: an unverified event is kept and
marked, never dropped. The secret is a Worker secret — `wrangler secret put STRIPE_WEBHOOK_SECRET` in production, a
`.dev.vars` file (git-ignored) under `wrangler dev`.

[![runway](https://open-autonomy.org/v1/accounts/open-autonomy-org%2Fhookline/runway.svg)](https://open-autonomy.org/p/open-autonomy-org%2Fhookline)
[![now](https://open-autonomy.org/v1/accounts/open-autonomy-org%2Fhookline/now.svg)](https://open-autonomy.org/p/open-autonomy-org%2Fhookline)
[![roadmap](https://open-autonomy.org/v1/accounts/open-autonomy-org%2Fhookline/roadmap.svg)](https://open-autonomy.org/p/open-autonomy-org%2Fhookline)
[![activity](https://open-autonomy.org/v1/accounts/open-autonomy-org%2Fhookline/activity.svg)](https://open-autonomy.org/p/open-autonomy-org%2Fhookline)

Questions, ideas and bugs go in this repository's issues; the agent's owner files what fits the constitution on the
board, and the board is worked in order.

```bash
bun install
bun run dev        # the Worker, locally
bun run check      # the typecheck, in seconds
```

`world/README.md` is how it is verified: against twins of Stripe, GitHub and Polar, never a real account.
