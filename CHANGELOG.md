# Changelog

## Unreleased
- Anything delivered can be delivered again, as a replay: `POST /events/<id>/replay` with `{"target": <name>}`
  delivers that event to that target again, and `POST /targets/<name>/replay?from=<event id>` (that event and
  everything after it) or `?since=<ISO time>` replays a range, in order. A replay is a distinct delivery row — it
  rides the queue behind the originals with the same retries and recorded attempts, marked `X-Hookline-Replay: true`
  on the wire and `replay: true` on every attempt on the event's record. A replay while an earlier one is still in
  flight is the same delivery; asking again after one finished delivers again. Proven in the world: a replayed event
  reaches the target's `/received` again with `X-Hookline-Replay: true`, a range replays in arrival order, and the
  event's record shows the replay distinct from the original.
- GitHub's and Polar's signatures are verified: an event delivered to `/in/github` is checked with GitHub's own scheme —
  the `X-Hub-Signature-256` header (`sha256=`, HMAC-SHA256 over the body keyed by `GITHUB_WEBHOOK_SECRET`) — and an event
  delivered to `/in/polar` with the Standard Webhooks scheme Polar signs (`webhook-id`/`webhook-timestamp`/
  `webhook-signature` v1, HMAC-SHA256 over `id.timestamp.body`, the secret's base64 bytes as the key, a 300s tolerance
  window) keyed by `POLAR_WEBHOOK_SECRET`. The verdict is recorded and shown like Stripe's. Proven in the world against
  the GitHub twin's own signed repository-webhook pipeline (the twin builds and signs the payload, the world registers
  the hook) and against Polar-shaped events signed the way Polar signs them (Standard Webhooks over real twin state):
  a signed delivery arrives `verified: true`; the same body with a wrong secret, a stale timestamp, and no header each
  arrive `verified: false` with the reason, kept and forwarded like any event.
- Stripe's signature is verified: an event delivered to `/in/stripe` is checked with Stripe's own scheme — the
  `Stripe-Signature` header (`t=`/`v1=`, HMAC-SHA256 over `t.body` keyed by `STRIPE_WEBHOOK_SECRET` from the Worker's
  bindings, a 300s tolerance window) — and the verdict is recorded on the event (`verified: true|false`, `verified_why`),
  returned by `POST /in/stripe`, `GET /events` and `GET /events/<id>`. Verification never blocks storage: an unverified
  event is kept and marked, never dropped. Proven in the world against the Stripe twin: an event driven through the
  twin's `emit` helper onto an enrolled endpoint arrives `verified: true`; the same body signed with a wrong secret, a
  stale timestamp, and no header at all each arrive `verified: false` with the reason, kept and forwarded like any event.
- The inbox forwards: every stored event is delivered to every target attached with `PUT /targets/<name>` (`{"url": ...}`; `GET /targets` lists them) as a `POST` with the raw body, the original headers under `X-Hookline-Original-` and `X-Hookline-Event`; any 2xx acknowledges, anything else is retried (1s, 5s, 30s, 2m, 10m, then hourly for a day), and every attempt is recorded on the event (time, target, status, error). Proven in the world: with the target answering at `/fail` the attempts accrue on the event's record; pointed at `/ok` the same event is delivered exactly once.
- The inbox keeps every webhook: `POST /in/<source>` stores an event (id, source, time, headers, raw body byte for byte) before answering 200 with the id; `GET /events` lists newest first, `GET /events/<id>` returns one with its headers and body. Proven against the Stripe twin in the world: its signed delivery is kept byte for byte and verifies with the endpoint's own secret.
- The repository was created with the Open Autonomy Hermes kit: a Worker that answers its health check, an inbox that keeps nothing yet, and a world of the vendors that will send it webhooks.
