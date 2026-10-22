# Proposal 2026-004: A reason says what it is for

Architecture: enterprise-architecture
Proposed version: 3.1.0 (minor: a clarification of AGT-12. It already requires a reason; "because I want it" never was one)
Proposed by: Architecture Board
Date: 2026-10-22

## Problem

[AGT-12](../../principles/ai-agents.md#agt-12-intent-stays-in-force-until-it-is-withdrawn) requires every request to say why. It doesn't say what counts as a why, so "because I want it" or "the director asked for it" fills the column without telling anyone what the request is for. The drift review then still can't judge spirit, and nobody can tell later whether the reason still holds.

## Change

1. **What counts as a reason.** A Why says what the request is **for**: who benefits, what problem it solves, or what goes wrong without it. Or it says what it **remedies**: "to remedy the bug introduced by version 2.3.1" is a reason, when it names what broke (a version, a release, an incident or a finding), because the purpose is the one the fix restores. Not reasons:
   - a restatement of the request;
   - preference alone ("because I want it", "it's nicer");
   - authority without the authority's own reason ("the director asked for it");
   - "everyone does it".

   The test: could someone use this Why to choose between two ways of building it, or to tell later whether it still holds?
2. **The Development Agent pushes back** on a non-reason, once or twice, in plain words: "What happens if we don't?", "Who is it for?". It doesn't push back on a fix that names what it remedies. If the Problem Owner still gives no reason, the agent records their words as they are, never a reason of its own, and adds an open question: "What is R-012 for?". The work goes on; the release waits for the answer.
3. **The Governance Agent validates every Why** at release, a request's own or its goal's, against this definition. A non-reason is a reason to reject, with the path forward: ask the Problem Owner what it is for. The Local Governance Agent's drift review reports a non-reason earlier, as an ambiguity finding.
4. **An anti-pattern**, AP-15 "The reason that isn't one", with two regression samples: a request with "because I want it" must be rejected, and a fix "to remedy the bug introduced by version 2.3.1" must be accepted.
5. **A small deterministic hint.** `check-intent.ts` warns about the obvious non-reasons: a Why that only repeats its request, or a handful of phrases such as "because I want it" or "requested by". These are warnings, at release too: judging a reason is the Governance Agent's work, and a hard failure on wording would only teach people to rephrase. A fix reason is never flagged.

## Trade-off

- **The cost:** sometimes a second question for the Problem Owner, and an occasional release that waits for an answer.
- **The gain:** reasons that can actually be used to judge spirit, weigh conflicts, and retire requests whose reason has gone.

## Simplification

None removed.

## Impact on the landscape

None for applications that already give real reasons. An application whose requests rest on non-reasons gets warnings now, and rejections at release, until the Problem Owner has said what those requests are for. Applications pinning 3.0.0 pass as if they pinned 3.1.0.

## Migration

Activation on 2026-10-22. 3.0.0 is superseded by 3.1.0.

---

## Board decision

Date: 2026-10-22
Decision: accepted and activated, with the explicit allowance that a fix naming what it remedies ("to remedy the bug introduced by version XYZ") is a reason.
Reasoning: A reason that doesn't say what something is for can't be used to judge it. Fixes are the exception that proves it: their purpose is already recorded, in the requirement they restore.
