# Release candidate

A release candidate is the unit the pipeline judges. The Development Agent prepares it when the Problem Owner says "Release". It lives in the application's repository at `releases/<id>/candidate.yaml`. Its `id` is `rc-YYYYMMDD-<n>`.

```yaml
id: rc-20261020-1
application: rejection-triage
commit: 3f9c2e1d8a...             # the exact commit; the pipeline builds from it

artifacts:                       # filled in by the pipeline's build, not by the Development Agent
  - name: rejection-triage
    digest: sha256:...

purpose: feature                 # feature | fix | security-fix | decommission
summary: >
  Agents can mark a customer as contacted. Rejections are grouped by error code
  with a 14-day trend.

decisions:                       # where the Problem Owner's gates were given (AGT-06)
  go: docs/decisions/0001-go.md
  release:
    by: dwhitfield               # directory id
    signed-tag: release/rc-20261020-1   # signed with the Problem Owner's workforce identity

declared-impact:                 # what the Development Agent believes is affected
  - application
  - data
  - network
  - load-balancing

evidence:
  tests:
    command: npm test
    result: releases/rc-20261020-1/test-results.txt
  test-review: docs/reviews/2026-10-19-first-release-test.md
  governance-review: docs/reviews/2026-10-19-first-release-governance.md
  models:                        # which model produced what (AGT-03); record exact model ids
    development: claude
    test: codex
    local-governance: codex

accepted-risks: []               # open findings proposed as accepted risks, for the Governance Agent to judge
#  - finding: docs/reviews/2026-10-19-first-release-test.md#t-4
#    reason: ...
#    proposed-by: dwhitfield

removal-dates: []                # temporary complexity introduced by this release (SIM-07)
```

## Rules for candidates

- The candidate refers to one commit. Everything the pipeline needs is in the repository at that commit: code, tests, migrations, `architecture.yaml`, decisions and reviews.
- The architecture versions are read from `architecture.yaml` at that commit, not from the candidate. That keeps them in one place.
- **The pipeline builds the artifacts** from the commit and records their digests. Everything after that (test, acceptance, production) refers to the digests ([DEL-01](../principles/delivery.md#del-01-every-change-is-a-release-candidate-with-evidence)).
- **Open findings are visible, not hidden.** Any Test Agent or Local Governance Agent finding that is still open must appear in `accepted-risks`. The Governance Agent compares the review files with this list. An open finding missing from the list is a rejection. What may be accepted at all is defined in [findings, risks and exceptions](../governance/escalation.md#findings-risks-and-exceptions).
- A candidate is immutable once submitted. A changed candidate is a new candidate with a new id.

## Evidence provenance

The candidate collects evidence; it doesn't prove it. The pipeline checks where each piece came from:

| Evidence | Authentic when |
|---|---|
| The Problem Owner's "Release" | The release tag is signed with the Problem Owner's workforce identity, or they approved the submission in the pipeline after signing in. |
| Test and Local Governance reviews | The review commits are signed with the key of the role's own session ([AGT-01](../principles/ai-agents.md#agt-01-separate-agents-for-separate-duties)). |
| Test results | The pipeline reruns the tests itself. The candidate's `test-results.txt` is only for reference. |
| Exceptions | They are in the Board's registry ([exceptions.yaml](../governance/exceptions.yaml)), never in the application's repository. |

In this proof of concept, evidence is files in the repository, and nothing is signed. A real pipeline must not accept that.

## After the verdict

The pipeline writes `verdict.md` next to `candidate.yaml` (format: [verdict.md](verdict.md)). If the candidate is approved and deployed, the deployment process appends `deployment.md` with what was deployed where and when, and the verification results.
