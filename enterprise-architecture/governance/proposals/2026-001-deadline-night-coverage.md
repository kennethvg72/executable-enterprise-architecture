# Proposal 2026-001: Support on deadline night

Architecture: enterprise-architecture
Proposed version: 1.1.0 (minor: responsibilities move to Central IT; nothing becomes stricter for applications). Released in 2.0.0, together with [2026-002](2026-002-intent-drift-review.md); 1.1.0 itself was withdrawn.
Proposed by: Architecture Board, from escalation 0001 of rejection-triage (in that application's repository)
Date: 2026-10-14

## Problem

[OWN-07](../../principles/ownership.md#own-07-operational-response-matches-resilience-class) covers class B application incidents in the filing season from 07:00 to 23:00 headquarters time. On the last three nights before the deadline, Customer Support works until 01:00, and taxpayers in the westernmost time zones file until 23:59 their time. Class B applications that support filing have no responder during the hours they matter most.

## Change

In OWN-07, replace the sentence after the table with:

> During the filing season (see [delivery](../../principles/delivery.md)), class B applications that support filing are covered on extended hours: 07:00–23:00 headquarters time, seven days a week, and 07:00–03:00 on the last three days before the deadline. Outside business hours, Central IT's on-call engineer responds, using the pipeline's rollback as the first remedy and the Development Agent to diagnose.

## Simplification

None removed. The alternative, one exception per class B application, would have created several exceptions with the same reason. That's the signal [escalation.md](../escalation.md#exceptions) says to treat as an architecture defect.

## Impact on the landscape

A minor version: no application has to change. Central IT's on-call rota covers three more nights a year, in the busiest week of the year.

## Migration

Activation proposed for 2026-11-01, well before the filing season. Version 1.0.0 stays active; applications pinning it pass as if they pinned 1.1.0 (minor versions never make rules stricter).

---

## Board decision

Date: 2026-10-14
Decision: accepted, pending the Central IT on-call rota for the three nights (owner: Jordan Alvarez)
Reasoning: The escalation showed a real gap, with a clear business impact, and no compliant path for any class B application. Fixing the architecture is the Board's job; exceptions would have hidden the gap.
