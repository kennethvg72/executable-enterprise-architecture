# Proposal 2026-014: The Governance Agent starts the others

Architecture: enterprise-architecture, network
Proposed version: enterprise-architecture 5.1.0, network 2.1.0 (minor: AGT-03 is relaxed, a context another agent starts counts; no rule becomes stricter for applications)
Proposed by: Architecture Board
Date: 2026-10-27

## Problem

[2026-013](2026-013-deployments-and-shared-systems.md) gave every shared system a steward: the Network Agent, a platform steward, a database steward and a Power Platform steward. With the Security Agent and the Governance Agent, that is six central agents, each in a session someone has to start, give a question to and read. The independence they need comes from their contexts, not from the windows they run in, and the one that gives them their questions is the Governance Agent.

## Change

1. **AGT-03: independence comes from separate contexts** ([AGT-03](../../principles/ai-agents.md#agt-03-independence-comes-from-separate-contexts)). Every agent works in a context of its own: its own process, instructions and files.
   - **A context another agent starts counts:** the Development Agent may start the local agents as subagents, and the Governance Agent starts the Security Agent and the stewards.
   - **Playing a role inside another agent's context doesn't count.**
   - **The deployment is never started by the Governance Agent:** it is the pipeline's own deployment process (AGT-05).
   - **The model rules stay:** different model families from the Development Agent, and the Security Agent on a different provider from the Governance Agent.
2. **[start-agent.ts](../../tools/start-agent.ts)** starts one central agent for one question, on its pinned model, with its instructions from [models.yaml](../../pipeline/models.yaml).
   - **What it gets:** copies only. A steward may change only its shared system's source, and only when the landscape names it as that system's steward.
   - **After the run:** a change anywhere else voids it, and nothing of it is kept. Otherwise its changes are written back to the source and committed there.
   - **The record:** the question, the answer, the transcript and the changes go to the verdict store, read-only.
   - **What it refuses:** the deployment, the Governance Agent itself, a role without an exact pin, and a Security Agent pinned to the Governance Agent's provider.
3. **models.yaml** lists the roles the Governance Agent starts, with their instructions and the shared systems they write. Their models are placeholders until the Board pins them: nothing is started on a placeholder.
4. **The instructions:** the Security Agent, the stewards and the Network Agent are started by the Governance Agent and answer only to it. The Governance Agent starts them, never plays their roles, and never writes a steward's source.

## The Board's decisions

Taken on 2026-10-27.

| | Decision | The Board's choice | Why |
|---|---|---|---|
| 1 | Who controls the other central agents | The Governance Agent starts them, each as a process of its own (not: it does their work itself) | The Board: "Yes, the Governance Agent starts the other agents,so A." The recommendation, accepted: the steward and the Governance Agent stay two judgments, and the steward's narrow scope holds. |
| 2 | Which agents | All, except the deployment | The Board: "The Governance Agents starts all, except indeed the Deployment Agent." An agent that could both approve and deploy would let one mistake reach production (AGT-05). |
| 3 | Why not separate sessions | | The Board: "Having all the agents in separate sessions is too much manual work without added value" |
| 4 | The Security Agent's provider | Still different from the Governance Agent's; start-agent.ts refuses one pinned to the same provider | Proposed when this was written for NATAX: NATAX's AGT-03 already asks for it (models.yaml), and starting the Security Agent from the Governance Agent must not quietly drop it. |

## Trade-off

- **The cost:** one more tool, and the Governance Agent's session does more.
- **The gain:** the central agents are started where their questions come from, with the separation where it matters: every agent's context, instructions and files its own, enforced by checking what it changed.

## Simplification

Five sessions someone would have had to run, one per central agent other than the Governance Agent, are gone.

## Impact on the landscape

None.

## Migration

None. Activation on 2026-10-27. enterprise-architecture 5.0.0 and network 2.0.0 are superseded.

---

## Board decision

Date: 2026-10-27
Decision: accepted and activated.
Reasoning: The Board's, in the table above: "Having all the agents in separate sessions is too much manual work without added value".
