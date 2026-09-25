# hookline roadmap

Notable intentions maintained by the Hermes PM scrum. Reconciled at scrum `5ff01a76` (main `c3715c6a`)
against landed history and the live board: every founding seed outcome — `receive`, `forward`, `stripe`,
`github-polar`, `replay`, `listen`, `deploy` — has a completed board task, landed commits, acceptance proven
in the project's world, and ships inside the owner's `deploy-v2026.09.06.3` tag. The seed import is retired;
the landed record lives in CHANGELOG.md. New outcomes wait on owner direction; an empty roadmap is not
permission to invent work.

## release-next: The next release of the reference inbox

Dispatch: hold
Release decision: accumulate
Target version: deploy-v<date>[.n] — the owner-cut tag names the release, per the project's observed policy
Target window: unset — no cadence agreed and nothing pending to ship
Review by: unset
Candidate: none
Scope: none — no authorized outcome is unshipped; main since `cd9d9daf` carries only Open Autonomy kit
  tooling, agent configuration and planning bookkeeping through kit 3.18.0 (PRs #42–#72), not product
Readiness: pending
Readiness evidence: none yet
Rationale: everything landed through `cd9d9daf` shipped on 2026-09-06 — the owner cut `deploy-v2026.09.06.3`
  (commit `cd9d9daf`) and the deploy run succeeded
  (https://github.com/open-autonomy-org/hookline/actions/runs/34065618527). A new decision is due when
  owner-authorized outcomes land.
Version rationale: releases are the owner's `deploy-v<date>[.n]` tags on the production environment; no
  package version or GitHub-release policy exists.
Live verification: the deployed instance is `https://hookline.aaron-0ed.workers.dev` (from the deploy run
  above); it answers, behind authentication.
Merge gate: the `main-protected` ruleset (id 22374727)
  requires one approving review, dismisses stale reviews on push,
  and permits no bypass; PRs #65–#68 each carry an approval at their exact landed head.
