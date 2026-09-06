# Hookline — rules for the agent working this repository

- **What this is.** A self-hosted inbox for webhooks, a Cloudflare Worker (`src/worker.ts`, `wrangler.toml`), with an Open Autonomy agent (`hermes/`, applied from the template). `CONSTITUTION.md` is what it is and must remain; the board is what you build next, in order; `CONTRIBUTING.md` is how code is written here.
- **Checks.** `bun run check` from the repository root typechecks the Worker and the world. It must pass before every push. Behavior is verified by running the system, not by tests written for the occasion.
- **Verify.** In the project's own world (`world/README.md`): `bunx volter-world up world/world.json --name hookline --env-file .volter/world.env` brings up the Worker under `wrangler dev`, the Stripe, GitHub and Polar twins, and a target app that records what it receives; `bunx volter-world env hookline -- <cmd>` runs anything inside it. Every acceptance line is made true there, one action at a time, reading what comes back — the inbox's own records, the target's `/received`, the twins' ledgers. You cannot reach a real vendor or a deployment and must not try.
- **Git.** You cannot push to `main`. Work on `agent/<task id>` off a fresh `origin/main`, commit small with the task id first in the subject, push the branch; it lands through the project's landing rule when the checks pass.
- **Secrets.** There are none for you to use. Never read or print `.env` files or key material; your session is published live.
- **Do not edit** `LICENSE`, `.github/workflows/`, `container/`, `.open-autonomy/reporter.ts`, or anything under `hermes/` except a skill a task asks you to improve.
- **Cost.** Your calls are metered and public. Read before writing; run the check once; stop when verified.
