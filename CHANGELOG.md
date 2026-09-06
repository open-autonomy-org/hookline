# Changelog

## Unreleased
- The inbox forwards: every stored event is delivered to every target attached with `PUT /targets/<name>` (`{"url": ...}`; `GET /targets` lists them) as a `POST` with the raw body, the original headers under `X-Hookline-Original-` and `X-Hookline-Event`; any 2xx acknowledges, anything else is retried (1s, 5s, 30s, 2m, 10m, then hourly for a day), and every attempt is recorded on the event (time, target, status, error). Proven in the world: with the target answering at `/fail` the attempts accrue on the event's record; pointed at `/ok` the same event is delivered exactly once.
- The inbox keeps every webhook: `POST /in/<source>` stores an event (id, source, time, headers, raw body byte for byte) before answering 200 with the id; `GET /events` lists newest first, `GET /events/<id>` returns one with its headers and body. Proven against the Stripe twin in the world: its signed delivery is kept byte for byte and verifies with the endpoint's own secret.
- The repository was created with the Open Autonomy Hermes kit: a Worker that answers its health check, an inbox that keeps nothing yet, and a world of the vendors that will send it webhooks.
