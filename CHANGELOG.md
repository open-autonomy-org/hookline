# Changelog

## Unreleased
- The inbox keeps every webhook: `POST /in/<source>` stores an event (id, source, time, headers, raw body byte for byte) before answering 200 with the id; `GET /events` lists newest first, `GET /events/<id>` returns one with its headers and body. Proven against the Stripe twin in the world: its signed delivery is kept byte for byte and verifies with the endpoint's own secret.
- The repository was created with the Open Autonomy Hermes kit: a Worker that answers its health check, an inbox that keeps nothing yet, and a world of the vendors that will send it webhooks.
