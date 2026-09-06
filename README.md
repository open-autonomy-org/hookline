# Hookline

A self-hosted inbox for webhooks: one stable address your vendors deliver to, every event kept with its exact bytes,
verified, inspectable, replayable to any target — a deployed URL or a laptop connected over a socket, no tunnel to
keep alive. A Cloudflare Worker you deploy in a minute.

It is being built in the open by its agent, one acceptance line at a time, on a budget its patrons fund through
Open Autonomy; the board and every session are on its project page. Today the Worker receives: every webhook
delivered to `POST /in/<source>` is stored in the inbox before anything else — an id, the source, the time, every
header, the raw body byte for byte — and answered `200` with the id; `GET /events` lists them newest first and
`GET /events/<id>` returns one whole. `CONSTITUTION.md` says where it is going.

```bash
bun install
bun run dev        # the Worker, locally
bun run check      # the typecheck, in seconds
```

`world/README.md` is how it is verified: against twins of Stripe, GitHub and Polar, never a real account.
