# Hookline's world

The Worker under `wrangler dev`, twins of the vendors that send webhooks (Stripe, GitHub, Polar), and a twin app as the
target that records what the inbox forwards. No account, no key, no cloud. Nothing in the world calls a real API.

```bash
bun install
bunx volter-world up world/world.json --name hookline --env-file .volter/world.env   # twins, the target, the Worker
bunx volter-world env hookline -- sh -c 'curl -s $HOOKLINE_URL/healthz'               # anything, inside the world
bunx volter-world env hookline -- sh -c 'curl -s $TARGET_URL/received'                # what the target received
bunx volter-world tail hookline --no-follow                                           # the twins' ledgers: what they saw
bunx volter-world down hookline --purge
```

A vendor's webhooks come from its twin the way they come from the vendor. Stripe: enrol an endpoint on the twin
(`POST $STRIPE_TWIN_URL/v1/webhook_endpoints` with `url` = `$HOOKLINE_URL/in/stripe`) and drive an event through its
test helpers — the twin signs and delivers, and `GET $STRIPE_TWIN_URL/twin` says what it stores and how. GitHub: the
twin service (`world/github.ts`) serves the real GitHub twin with its repository-webhook pipeline wired, the hook
registered to `$HOOKLINE_URL/in/github` and signed with the twin's own `X-Hub-Signature-256` (the secret is the world's
fixture value, the Worker's binding the same) — drive a write through the twin's REST API (`POST
$GITHUB_TWIN_URL/repos/<owner>/<repo>/issues`, for one) and the twin delivers the signed webhook itself; its ledger is
`GET $GITHUB_TWIN_URL/twin/store/mirror`. Polar: the twin stores orders (`POST $POLAR_TWIN_URL/v1/checkouts/` then
`POST $POLAR_TWIN_URL/v1/checkouts/:id/confirm` makes one); its own webhook delivery is an unimplemented capability of
the pack, so the twin service carries a signer — `POST $POLAR_TWIN_URL/twin/emit?order=<id>` signs the order as an
`order.created` event the way Polar signs (Standard Webhooks, the key the spec derives) and delivers it to every
endpoint enrolled with `POST $POLAR_TWIN_URL/v1/webhooks/endpoints/` (`url` = `$HOOKLINE_URL/in/polar`). Drive it one
action at a time and read what comes back; nothing here asserts.
