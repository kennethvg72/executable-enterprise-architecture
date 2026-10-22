# Proposal 2026-003: Every request says why

Architecture: enterprise-architecture, with typescript-web, power-apps and android
Proposed version: enterprise-architecture 3.0.0 (major: the pipeline refuses a release candidate with a request in force that has no reason); typescript-web, power-apps and android 1.2.0 (minor: template conventions)
Proposed by: Architecture Board
Date: 2026-10-22

## Problem

[AGT-12](../../principles/ai-agents.md#agt-12-intent-stays-in-force-until-it-is-withdrawn) made intent stay in force until it is withdrawn, and asks the Local Governance Agent to find implementations that satisfy the letter of intent but not its spirit. For rules and decisions that works: rules have a Why, and decision records have their context and alternatives. Requests don't. The requirements log records what the Problem Owner asked for, not why, so the review can only check the letter, and a deprecation records what was dropped, not whether its reason still holds.

## Change

1. **Every request has a reason, the Problem Owner's.**
   - Each entry in the requirements log has a Why, in the Problem Owner's words, or it cites a goal.
   - Deprecation and supersession entries carry their own Why.
   - The Why is the Problem Owner's, never an agent's. An agent never writes a reason the Problem Owner didn't give.
   - A missing reason is recorded as missing ("not given"), with an open question (Q-) asking for it.
2. **Goals.** A short numbered list at the top of `docs/requirements.md` (G-1, G-2, ...), each with its own Why. A request may cite a goal instead of stating a Why. Goals are intent too: they stay in force until withdrawn, and the drift review covers them.
3. **The check.** `check-intent.ts` flags requests in force with neither a Why nor a goal: a reason recorded as missing, a cited goal that doesn't exist, or nothing at all. It **warns** when run locally, and **fails** at release, for a release candidate.
4. **The review.** The letter-not-spirit class applies to requests too, judged against their Why, or their goal's.

## Trade-off

- **The cost:** one more question for the Problem Owner, per request: "why?". When they don't know yet, it's recorded as missing, and the request can still be built and tested. Only the release waits for the answer.
- **The gain:** the review can judge spirit, not only letter. A later reader of a deprecation knows whether its reason still holds, and two conflicting requests can be weighed by their purpose.
- **What it doesn't do:** check whether a Why is true, or whether it's really the Problem Owner's. The rule says it must be. The Local Governance Agent treats a Why that reads like an agent's justification as a finding.

## Simplification

None removed. Goals keep it short: one reason serves the many requests that share it.

## Impact on the landscape

Applications pinning 3.0.0 give every request in force a reason before their next release. Applications on 2.0.0 aren't bound until they migrate. No application in the landscape has its repository here, so the impact run found nothing to measure.

## Migration

Activation on 2026-10-22. enterprise-architecture 2.0.0 is deprecated, with decommission on 2027-06-01, the same date as 1.0.0, outside the filing season. The platform architectures move to 1.2.0, a minor version; 1.0.0 and 1.1.0 pass as 1.2.0.

---

## Board decision

Date: 2026-10-22
Decision: accepted and activated, with three specifics: the Why is the Problem Owner's and a missing one is recorded as missing with an open question; requests may cite a goal instead; the check warns locally and fails at release.
Reasoning: Recorded intent without its reason can only be checked to the letter. The reason has to come from the person who owns the intent; a reason an agent invents would make the review agree with the agent.
