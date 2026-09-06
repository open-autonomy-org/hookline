# The constitution of Hookline

What this project is and must remain. No task may violate an invariant, and no change may enter what is out of
scope; the review holds every diff to this file.

## What it is

A self-hosted inbox for webhooks. Vendors deliver to one stable address that is yours; every event is kept with its
exact bytes and headers, verified, inspectable and replayable; deliveries go to any target you attach — a deployed
URL, or a laptop connected over a socket — each with its own cursor and retries. It is a Cloudflare Worker you
deploy in a minute.

The north star: **Hookline is the best way to receive webhooks.** Nothing is ever lost, every event is inspectable
and verifiable, any of it replays to any target, it deploys in a minute, and every vendor it claims is proven
against that vendor's twin. Where a choice arises, the more reliable, more faithful, simpler answer wins.

## Invariants

- An event is stored before anything else happens, with its raw body and its headers, and is never modified or
  deleted by the software.
- Every delivery is attempted until acknowledged or until the target's retry policy is exhausted, and every attempt
  is recorded.
- A vendor's signature is verified with the vendor's own scheme and the result is recorded, never assumed.
- A target sees every event exactly once, in order; a replay is explicit and recorded as one.
- The public address never changes because targets change.
- Secrets live in the Worker's bindings, never in the inbox's records or its UI.
- Every vendor the inbox claims to understand is proven against that vendor's twin in the project's world.
- `bun run check` finishes in under thirty seconds, and a test guards an invariant of this file or is not written.

## Out of scope

- Transforming payloads on the way through.
- A queue for anything but webhooks.
- Hosting other people's inboxes: one deployment is one owner's.
