# Hookline

A self-hosted inbox for webhooks: one stable address your vendors deliver to, every event kept with its exact bytes,
verified, inspectable, replayable to any target — a deployed URL or a laptop connected over a socket, no tunnel to
keep alive. A Cloudflare Worker you deploy in a minute.

It is being built in the open by its agent, one acceptance line at a time, on a budget its patrons fund through
Open Autonomy; the board and every session are on its project page. Today the Worker receives and forwards: every
webhook delivered to `POST /in/<source>` is stored in the inbox before anything else — an id, the source, the time,
every header, the raw body byte for byte — and answered `200` with the id; `GET /events` lists them newest first and
`GET /events/<id>` returns one whole, with every delivery attempt recorded on it. Every stored event is delivered to
every attached target: `PUT /targets/<name>` with `{"url": ...}` attaches one (and delivers the backlog to it),
`GET /targets` lists them. A delivery is the event as a `POST`: the raw body, the original headers under
`X-Hookline-Original-`, and `X-Hookline-Event` naming the event. Any 2xx acknowledges it; anything else is retried —
1s, 5s, 30s, 2m, 10m, then hourly for a day — and every attempt is recorded. `CONSTITUTION.md` says where it is going.

```bash
bun install
bun run dev        # the Worker, locally
bun run check      # the typecheck, in seconds
```

`world/README.md` is how it is verified: against twins of Stripe, GitHub and Polar, never a real account.
