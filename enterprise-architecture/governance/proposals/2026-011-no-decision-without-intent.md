# Proposal 2026-011: No decision without intent

Architecture: enterprise-architecture
Proposed version: 4.1.0 (minor: the Board's own conduct; no rule for applications becomes stricter)
Proposed by: Architecture Board
Date: 2026-10-26

## Problem

[AGT-12](../../principles/ai-agents.md#agt-12-intent-stays-in-force-until-it-is-withdrawn) requires every request an application acts on to carry its reason, the Problem Owner's, and never an agent's. The Board holds itself to less. "Decisions are recorded in the proposal: what was decided, why", but nothing says whose reason it must be, or what happens when there is none. Exceptions and accepted risks are decisions too, and an agent drafting them for the Board can fill the reason in as easily as it fills a requirements log.

A decision whose reason nobody gave can't be weighed against a later one, or retired when its reason is gone. And a decision that can be taken without writing down why is one that can happen without anyone deciding it.

## Change

1. **No decision without intent** ([architecture-board.md](../architecture-board.md)): every decision of the Board (a proposal's acceptance, an exception, an accepted risk, a choice between options) records its reason, given by the Board. An agent may propose a reason; it becomes the Board's only when the Board gives or confirms it. A decision without a reason isn't taken: it is recorded as "reason not given", with the question, and nothing that depends on it is activated.
2. **The proposal template's "Reasoning"** says so, and **exceptions.yaml's header** names the Board's own reason as part of every exception.
3. **Tests:** an exception without a reason covers nothing (as before, now tested), and every decided proposal in this repository has its reasoning.

## Trade-off

- **The cost:** sometimes a decision waits for a sentence from the Board.
- **The gain:** every decision can be traced to the people who took it, and why, and the act of writing the reason makes them own it.

## Simplification

None removed.

## Impact on the landscape

None.

## Migration

None. Activation on 2026-10-26. 4.0.0 is superseded by 4.1.0.

---

## Board decision

Date: 2026-10-26
Decision: accepted and activated.
Reasoning: The Board: a rule that makes the Problem Owner give the reason for every request should bind the Board first. Having to write the reason forces whoever decides to think, and to own the decision.
