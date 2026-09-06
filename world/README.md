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

A vendor's webhooks come from its twin the way they come from the vendor: enrol an endpoint on the Stripe twin
(`POST $STRIPE_TWIN_URL/v1/webhook_endpoints` with `url` = `$HOOKLINE_URL/in/stripe`) and drive an event through
its test helpers; the twin signs and delivers, and `GET $STRIPE_TWIN_URL/twin` says what it stores and how. The
GitHub twin delivers repository webhooks the same way; Polar's twin stores orders and the world signs what Polar
would send. Drive it one action at a time and read what comes back; nothing here asserts.
