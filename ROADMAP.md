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
Scope: none — no authorized outcome is unshipped; main since `9157cdd9` carries only Open Autonomy kit
  tooling (kit 2.10.0 PR #42, kit 2.11.0 PR #43), not product
Readiness: pending
Readiness evidence: none yet
Rationale: everything landed through `9157cdd9` shipped on 2026-09-06 — the owner cut `deploy-v2026.09.06.3`
  (commit `9157cdd9`) and the deploy run succeeded
  (https://github.com/open-autonomy-org/hookline/actions/runs/34065618527). A new decision is due when
  owner-authorized outcomes land.
Version rationale: releases are the owner's `deploy-v<date>[.n]` tags on the production environment; no
  package version or GitHub-release policy exists.
Live verification: pending — the deployed instance's address is not recorded anywhere the agent can read,
  so post-release verification of the live service has no source yet.
Merge-gate gap: the `main-protected` ruleset (id 22374727, verified via the GitHub rulesets API on
  2026-09-13) requires `required_approving_review_count: 0` and `dismiss_stale_reviews_on_push: false`,
  contradicting `.open-autonomy/PRODUCTION.md`'s required setup (1 approving review, stale dismissals,
  no bypass actors). PRs #43, #45, #46 and #47 merged with zero GitHub approvals. Fixing it is
  owner/setup authority; PM holds release decisions pending a candidate that has passed a real review
  gate until then.
