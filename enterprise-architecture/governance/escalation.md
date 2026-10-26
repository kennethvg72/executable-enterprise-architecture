# Escalation

When a Development Agent hits a requirement it can't implement under the published architecture, it doesn't work around the rule ([AGT-04](../principles/ai-agents.md#agt-04-agents-read-the-architecture-they-dont-edit-it)). It escalates to the Architecture Board.

Escalating is normal. It is how the architecture learns where it doesn't fit reality.

## When to escalate

- A requirement can't be met without breaking a rule, and the Local Governance Agent agrees there's no compliant alternative.
- Two rules contradict each other.
- A rule is unclear enough that agents keep interpreting it differently.
- The Governance Agent rejected a candidate and couldn't provide a compliant path forward, or the path it gave is unworkable.

Don't escalate to get a decision you don't like reversed. Disagreement about *intent* goes to the Problem Owner. Disagreement with a Test Agent finding is recorded in the release candidate for the Governance Agent to judge.

## How

The Development Agent writes the escalation using the [template](../templates/escalation.md) and files it in the application's repository at `docs/escalations/`. In a real deployment it is also submitted to the Board's queue. The Development Agent tells the Problem Owner, who can add their view.

An escalation contains: the requirement, the rule or rules in the way, the compliant alternatives considered and why they don't work, what the team proposes, and the Problem Owner's view of the business impact.

## Possible outcomes

The Board answers every escalation with one of these. **"Rejected" on its own is not an answer.**

| Outcome | Meaning |
|---|---|
| **Compliant path** | There is a compliant way to meet the requirement that the team hadn't found. The Board describes it. |
| **Architecture change** | The rule is wrong, incomplete or obsolete. The Board changes it (through a new [version](lifecycle.md)), often helped by the evidence in the escalation. Until the new version is active, a time-boxed exception covers the gap. |
| **Requirement challenged** | The requirement itself isn't justified, or meeting it would cost more than the problem is worth. The Board explains why, and what *could* be done instead. The Problem Owner may respond. |
| **Time-boxed exception** | The rule is right, but this case can't comply yet (typically legacy). See below. |

## Exceptions

Exceptions are the last resort, never the default fix for an architectural shortcoming.

- Every exception has a **named owner**, an **expiry date** (at most 12 months), the **rule IDs** it covers, and the **compensating controls** that apply until it ends. The pipeline checks all of it before an exception covers anything: an exception with an owner who left, a rule that doesn't exist, no compensating controls or more than 12 months covers nothing, and is a failure itself. A valid exception turns failures of exactly its rules, for exactly its application, into warnings that cite it.
- Exceptions are recorded in the Board's registry, [exceptions.yaml](exceptions.yaml), never in the application's own repository. The pipeline applies them and warns before they expire ([SIM-07](../principles/simplicity.md#sim-07-temporary-complexity-has-an-owner-and-an-end-date)).
- An expired exception is treated as a failed check.
- **If the same exception is requested for a second application, the Board must consider an architecture change instead.** Repeated exceptions are evidence that the architecture describes an environment that doesn't exist.

## Findings, risks and exceptions

There is one way to handle each kind of non-compliance:

| Situation | Handled by |
|---|---|
| A **mandatory rule** is broken | Fix it, or get a Board **exception** (above). Nothing else. |
| A **default** ("should", "by default") isn't followed | A **decision record** in the application's repository. The Governance Agent judges whether the reason holds. |
| A Test Agent or Local Governance Agent **finding** that isn't a broken mandatory rule | Fix it; or the Problem Owner **overrules** it, with a reason, and it is listed as overruled in the release candidate; or list it as a proposed **accepted risk** in the release candidate, with a reason. The Governance Agent judges the reason either way. |
| A Security Agent **finding** that isn't a broken mandatory rule | Fix it, or list it as a proposed **accepted risk** in the release candidate, with a reason. The Governance Agent judges the reason. Nobody overrules it locally. |
| A **High or Critical security finding** | Never accepted locally. Fix it, or get a Board exception ([SEC-08](../principles/security.md#sec-08-security-findings-have-deadlines-not-opinions)). |

The Problem Owner and the Development Agent can *propose* that a risk be accepted. Neither can *accept* one. The Problem Owner can overrule a local agent's finding, on the record, and the Governance Agent still judges it ([AGT-02](../principles/ai-agents.md#agt-02-nobody-overrules-the-governance-agent-and-a-local-finding-is-overruled-only-on-the-record)).
