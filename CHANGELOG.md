# Changelog

## deploy-v2026.09.06.3 — 2026-09-06

Everything in this section shipped on 2026-09-06: the owner cut the tag `deploy-v2026.09.06.3` at commit
`9157cdd9b645a8c47100e4c7b0ddcae24e9c2060` and the deploy run succeeded
([run 34065618527](https://github.com/open-autonomy-org/hookline/actions/runs/34065618527)). Each entry
names its board task (`hermes:task/<id>`), which records the world-proven acceptance for that line.

- The inbox is the owner's to read: a secret `HOOKLINE_READ_TOKEN` guards everything that reads or replays —
  `GET /` (the page), `GET /events`, `GET /events/<id>`, `GET /targets`, `PUT /targets/<name>`, every `/replay`
  route, and the websocket a `hookline listen` target connects with, presented as `Authorization: Bearer ***`
  (`?token=` on the socket handshake). A guarded request without it is refused 401 with one line and nothing about
  the inbox's contents; a browser is shown that one line plus a form that asks for the token, which the page then
  keeps in local storage. The vendor doors stay open (`POST /in/<source>` needs no token — a vendor cannot send one —
  and `GET /api` answers `{name, version}` to anyone), and `GET /healthz` answers the world's readiness probe. The
  page asks for the token once and keeps it in the browser's local storage; `hookline listen` takes it as `--token`
  (or `HOOKLINE_READ_TOKEN` in its environment) and puts it on the socket handshake. With the secret unset the
  inbox refuses every read with 503, saying the secret is missing — it never falls open. Proven in the world: a
  read without the token is 401, hermes:task/t_abbf633f.
- Deploy in a minute: the README walks from a fresh clone to `bunx wrangler deploy` (with
  `--define HOOKLINE_VERSION:"\"$(git rev-parse --short HEAD)\""` so the Worker says what version it runs), a vendor
  pointed at the inbox's address, the secrets set through `wrangler secret put`, and the first event on `/events` —
  every command in it the one that works. The Worker itself has a face now: `GET /` serves the operator's page — the
  events newest first, each with its signature verdict and the reason when unverified, each target's recorded
  attempts, a replay button that calls `POST /events/<id>/replay` — with no build step (one static HTML document
  whose script reads the same API everything else reads), and `GET /api` answers `{name, version}`. Proven in the
  world: the page served with the events' verification and deliveries shown and a replay made from it reaching the
  target's `/received`, `/api` answering the deployed rev, hermes:task/t_bed6b0d8.
- Anything delivered can be delivered again, as a replay: `POST /events/<id>/replay` with `{"target": <name>}`
  delivers that event to that target again, and `POST /targets/<name>/replay?from=<event id>` (that event and
  everything after it) or `?since=<ISO time>` replays a range, in order. A replay is a distinct delivery row — it
  rides the queue behind the originals with the same retries and recorded attempts, marked `X-Hookline-Replay: true`
  on the wire and `replay: true` on every attempt on the event's record. A replay while an earlier one is still in
  flight is the same delivery; asking again after one finished delivers again. Proven in the world: a replayed event
  reaches the target's `/received` again with `X-Hookline-Replay: true`, hermes:task/t_a6dd5aec.
- A laptop is a target: `bun src/cli.ts listen --inbox <inbox url> --to http://localhost:3000` connects out to the
  inbox over a websocket as a named target (`PUT /targets/<name>` with `{"url": "hookline-socket:<name>"}` first),
  the inbox delivers events down that socket in order from the target's cursor — one frame at a time, stop-and-wait —
  the CLI posts each to the local URL exactly as a URL delivery would arrive (the same `X-Hookline-Original-*` and
  `X-Hookline-Event` headers, the raw body byte for byte) and acknowledges it back; the cursor advances only on
  acknowledgement. Anything else is a nack: recorded like any failed attempt and retried on the socket on the usual
  schedule. Closing the CLI queues events; reopening delivers what was missed, in order, exactly once — no inbound
  port on the laptop, no tunnel to keep alive. Replays ride the socket too, marked `X-Hookline-Replay: true`. Proven
  in the world: the CLI attached to a local target, events driven from the twins, the target's `/received` complete
  and in order across a disconnect, hermes:task/t_4e95ec42.
- GitHub's and Polar's signatures are verified: an event delivered to `/in/github` is checked with GitHub's own scheme —
  the `X-Hub-Signature-256` header (`sha256=`, HMAC-SHA256 over the body keyed by `GITHUB_WEBHOOK_SECRET`) — and an event
  delivered to `/in/polar` with the Standard Webhooks scheme Polar signs (`webhook-id`/`webhook-timestamp`/
  `webhook-signature` v1, HMAC-SHA256 over `id.timestamp.body`, the secret's base64 bytes as the key, a 300s tolerance
  window) keyed by `POLAR_WEBHOOK_SECRET`. The verdict is recorded and shown like Stripe's. Proven in the world against
  the GitHub twin's own signed repository-webhook pipeline (the twin builds and signs the payload, the world registers
  the hook) and against Polar-shaped events signed the way Polar signs them (Standard Webhooks over real twin state):
  a signed delivery arrives `verified: true`; the same body with a wrong secret, a stale timestamp, and no header each
  arrive `verified: false` with the reason, kept and forwarded like any event, hermes:task/t_5a74c7fb.
- Stripe's signature is verified: an event delivered to `/in/stripe` is checked with the vendor's own scheme — the
  `Stripe-Signature` header (`t=`/`v1=`, HMAC-SHA256 over `t.body` keyed by `STRIPE_WEBHOOK_SECRET` from the Worker's
  bindings, a 300s tolerance window) — and the verdict is recorded on the event (`verified: true|false`, `verified_why`),
  returned by `POST /in/stripe`, `GET /events` and `GET /events/<id>`. Verification never blocks storage: an unverified
  event is kept and marked, never dropped. Proven in the world against the Stripe twin: an event driven through the
  twin's `emit` helper onto an enrolled endpoint arrives `verified: true`; the same body signed with a wrong secret, a
  stale timestamp, and no header at all each arrive `verified: false` with the reason, kept and forwarded like any event, hermes:task/t_cb5dbf36.
- The inbox forwards: every stored event is delivered to every target attached with `PUT /targets/<name>` (`{"url": ...}`; `GET /targets` lists them) as a `POST` with the raw body, the original headers under `X-Hookline-Original-` and `X-Hookline-Event`; any 2xx acknowledges, anything else is retried (1s, 5s, 30s, 2m, 10m, then hourly for a day), and every attempt is recorded on the event (time, target, status, error). Proven in the world: with the target answering at `/fail` the attempts accrue on the event's record; pointed at `/ok` the same event is delivered exactly once, hermes:task/t_39c944ac.
- The inbox keeps every webhook: `POST /in/<source>` stores an event (id, source, time, headers, raw body byte for byte) before answering 200 with the id; `GET /events` lists newest first, `GET /events/<id>` returns one with its headers and body. Proven against the Stripe twin in the world: its signed delivery is kept byte for byte and verifies with the endpoint's own secret, hermes:task/t_8e64a158.
- The repository was created with the Open Autonomy Hermes kit: a Worker that answers its health check, an inbox that keeps nothing yet, and a world of the vendors that will send it webhooks.
