# Hookline

A self-hosted inbox for webhooks: one stable address your vendors deliver to, every event kept with its exact bytes,
verified, inspectable, replayable to any target — a deployed URL or a laptop connected over a socket, no tunnel to
keep alive. A Cloudflare Worker you deploy in a minute.

It is being built in the open by its agent, one acceptance line at a time, on a budget its patrons fund through
Open Autonomy; the board and every session are on its project page. Today the Worker answers its health check and
nothing more. `CONSTITUTION.md` says where it is going.

```bash
bun install
bun run dev        # the Worker, locally
bun run check      # the typecheck, in seconds
```

`world/README.md` is how it is verified: against twins of Stripe, GitHub and Polar, never a real account.
