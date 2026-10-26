# The Architecture Board

The Architecture Board is accountable for the NATAX architecture, and for what the pipeline is allowed to approve. Because the architecture is applied automatically across hundreds of systems, a good decision by the Board is worth a great deal. A bad one spreads just as far.

## Members

The Board is small: the Chief Architect (chair), the architects for application, infrastructure, network and security, and one rotating Problem Owner from the business. The Board pulls in specialists, internal or external, whenever a decision is beyond its depth. Knowing when to do that is part of the job.

Members need real technical breadth, enough depth to challenge specialists as peers, an understanding of where disciplines interact, and the acceptance that the architecture is never finished.

## What the Board does

1. **Owns the architecture.** Every change to `enterprise-architecture/` and to the network, infrastructure and platform architectures is approved by the Board, as a new [version](lifecycle.md). The [landscape](../landscape/README.md) is the exception: it is data about what NATAX runs, not architecture, written by the pipeline and Central IT, and not versioned.
2. **Resolves escalations** ([escalation.md](escalation.md)) within five business days, or two during the filing season.
3. **Improves the architecture from evidence.** It reads the architecture feedback in pipeline verdicts, the escalations, the exceptions and their trends, and the results of [architecture reviews](architecture-review.md).
4. **Decides what may be automated.** The Board decides which rules the Governance Agent may approve on its own, and which need a human. Today the Governance Agent decides every release candidate; the Board decides architecture changes and exceptions.

## What the Board doesn't do

- **Review individual projects.** The pipeline does that, consistently, for every release. The Board only sees a project when it escalates.
- **Say "no" without a path forward.** The rule that binds the Governance Agent binds the Board: every rejected design comes with a compliant path forward.
- **Grant exceptions to avoid fixing the architecture.** If the same exception is needed twice, the architecture needs to change.

## How the Board decides

- Changes to the architecture are proposed as pull requests against this repository, using the [proposal template](../templates/architecture-proposal.md). Anyone can propose, including agents (through an escalation) and the Board itself.
- Before a version becomes mandatory, it is **run against the landscape** ([lifecycle.md](lifecycle.md)). Agents identify conflicts and estimate the changes needed. Some findings reveal shortcomings in existing systems; others reveal shortcomings in the proposal. Both are what the Board wants to learn.
- Decisions are recorded in the proposal: what was decided, why, and what evidence was used.

## No decision without intent

Every decision of the Board (a proposal's acceptance, an exception, an accepted risk, a choice between options) records its reason, given by the Board. An agent may propose a reason; it becomes the Board's only when the Board gives or confirms it. A decision without a reason isn't taken: it is recorded as "reason not given", with the question, and nothing that depends on it is activated.

**Why.** A decision without a reason can't be weighed against a later one, or retired when its reason is gone. And having to write the reason is what makes the people deciding own the decision, instead of letting it happen. That is [AGT-12](../principles/ai-agents.md#agt-12-intent-stays-in-force-until-it-is-withdrawn), for the Board itself.

**Verified by.** `test`: an exception without a reason covers nothing, and every decided proposal has its reasoning. `review`: the Governance Agent and the next [architecture review](architecture-review.md) read the reasons.
