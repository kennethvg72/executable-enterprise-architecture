# Proposal 2026-002: Intent stays in force until it is withdrawn

Architecture: enterprise-architecture, with typescript-web, power-apps and android
Proposed version: enterprise-architecture 2.0.0 (major: a new mandatory rule, and the pipeline refuses candidates without its evidence); typescript-web, power-apps and android 1.1.0 (minor: template conventions)
Proposed by: Architecture Board, from a reader's question
Date: 2026-10-22

## Problem

A reader asked whether the verifier catches drift from intent, not just rule violations. The honest answer: the deterministic checks can't. They check rules, and intent isn't a rule. Reviewers can, but only if the intent is recorded and someone is explicitly tasked with re-reading all of it.

Today nobody is. The agents compare a change with the architecture and with the latest requests. Agents weigh recent requests heavily, so a requirement from three months ago that nobody withdrew can be broken quietly, by an implementation that satisfies everything asked this week. Nothing makes an agent re-read every request ever made.

## Change

1. **A principle, AGT-12: intent stays in force until it is withdrawn.**
   - Intent is recorded in the repository with an ID: requirements (R-), decisions (D-, the decision record's number), open questions (Q-) and escalations (E-).
   - A requirement or decision stays in force until a record explicitly deprecates or supersedes it. Silence is not deprecation.
   - Before every release candidate, the Local Governance Agent reviews the whole recorded intent against the implementation. That is not required during quick iterations for testing.
2. **A new duty for the Local Governance Agent: the intent-drift review.**
   - It reconstructs the inventory of in-force intent and checks each item against the implementation.
   - It reports findings in exactly five classes: forgotten requirement, contradiction, ambiguity, letter-not-spirit, and untested requirement.
   - Each finding carries one proposed resolution: fix the implementation, deprecate the requirement explicitly, clarify it, or propose an architecture change.
   - The agent changes nothing itself. A letter-not-spirit finding against an architecture rule is an escalation, not a local fix.
3. **A report template**, [intent-drift-report.md](../../templates/intent-drift-report.md), ending with the inventory counts.
4. **Evidence for the pipeline.**
   - The report is part of every release candidate.
   - The Governance Agent reads it, re-checks a few in-force items itself, and rejects, with a path forward, for an unresolved letter-not-spirit or contradiction finding.
   - The deterministic stage checks three things: a report exists for the candidate's commit range; nothing has changed the recorded intent since; and every in-force ID appears in its inventory.
5. **Template conventions**, in all three platforms' templates:
   - an append-only requirements log, with a date and an ID for every request;
   - deprecation as its own entry, referencing the ID;
   - IDs for open questions and escalations.

   The Development Agent records every request as part of handling it.
6. **Tools:** the presence, staleness and coverage checks in the pipeline's deterministic stage, each with a test that shows what it catches.

Also folded into 2.0.0: proposal [2026-001](2026-001-deadline-night-coverage.md), accepted for 1.1.0 and not yet activated, so that one release carries both.

## Trade-off

**The cost:** one more review before every release candidate.
- The Local Governance Agent re-reads every in-force item and compares it with the implementation.
- The cost grows with the number of items in force, not with the application's history: explicit deprecation keeps that set small.
- For an application with about 50 in-force items, a few minutes of agent time per release candidate.
- No time from the Problem Owner unless there are findings, and then only for the resolutions only they can choose.
- None during quick iterations for testing: the review is for release candidates.

**The real cost:** the discipline of recording every request and every deprecation. That discipline is also the point. A requirement that nobody wrote down can't be checked, and one that nobody withdrew still binds.

**What it doesn't do:** detect drift deterministically. That isn't possible. The deterministic checks only make sure the review happened, is current, and covered everything; the review itself is judgment.

## Simplification

None removed. The review replaces nothing, because nothing did this before. The alternative, relying on the Governance Agent to notice drift in a diff, can't work: a diff shows what changed, not what was forgotten.

## Impact on the landscape

- Every application pinning 2.0.0 keeps an intent log in this form and carries a drift report with each release candidate.
- Applications on 1.0.0 aren't bound until they migrate.
- Run against the landscape: no application in the landscape has its repository here, so the impact run found nothing to measure. Each application meets the new rule at its first release after migrating, which is where a first drift report is cheapest: the inventory is built once and then kept current.

## Migration

Activation on 2026-10-22. enterprise-architecture 1.0.0 is deprecated, with decommission on 2027-06-01. Six months would end on 2027-04-22, inside the filing season, which a migration window never does.

The platform architectures move to 1.1.0, a minor version. Applications pinning 1.0.0 pass as if they pinned 1.1.0.

---

## Board decision

Date: 2026-10-22
Decision: accepted, activated on 2026-10-22, with the addition that the review is required before every release candidate, not during quick iterations for testing. enterprise-architecture 1.0.0 is deprecated until 2027-06-01; 1.1.0 is withdrawn, its change included in 2.0.0.
Reasoning: Intent that nobody re-reads drifts, and drift should be a decision, not an accident. The cost is a review per release candidate, proportional to what is still in force; the gain is that forgotten requirements surface before production instead of in it.
