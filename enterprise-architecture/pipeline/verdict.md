# Verdict

The Governance Agent writes a verdict for every release candidate, next to it: `releases/<id>/verdict.md`. A verdict is **approved** or **rejected**. There is no "approved with conditions".

A rejection is not complete without a compliant path forward. If the Governance Agent can't describe one, the architecture may be the problem: it rejects and opens an [escalation](../governance/escalation.md) to the Architecture Board.

## Format

```markdown
# Verdict: <candidate id>

Application: <name>
Commit: <sha>
Verdict: approved | rejected
Governance Agent: <model>
Architecture versions applied: enterprise-architecture 1.0.0, typescript-web 1.0.0, ...
Date: <ISO 8601>

## Impact
Declared: application, data
Determined: application, data, network
Difference: the diff adds an outbound call to notification-service (src/notify.ts:14)
that isn't declared in architecture.yaml `consumes`.

## Deterministic checks
<output of `npm run pipeline`, or a summary with a link to the full output>

## Review
| Rule | Result | Evidence |
|---|---|---|
| SIM-01 | compliant | No new dependencies. |
| DAT-02 | compliant | Stores filing reference only (migrations/0003_contacts.sql). |
| RES-07 | non-compliant | No test covers notification-service being unavailable. |

## Local findings
<each open finding from the Test and Local Governance reviews, and whether its acceptance is allowed>

## Security findings
<the Security Agent's report (releases/<id>/security.md) when the impact required one: each finding,
its SEC-08 rating, and whether it is fixed; or why no attack was required>

## Reasons
<for a rejection: each blocking issue, with its rule ID>

## Path forward
<for a rejection: for each blocking issue, exactly what to change so the candidate would pass>
1. Add notification-service to `consumes` in architecture.yaml (port 8443, purpose).
2. Add a test showing that contacting a customer still records the contact, and shows
   a clear message, when notification-service is unavailable (RES-07).

## Architecture feedback
<optional: rules that caused friction, seemed wrong, or were unclear; the Board reads these>
```

## Who reads it

- The **Development Agent** acts on the path forward, and brings any questions about intent to the Problem Owner.
- The **Problem Owner** reads the summary; the Development Agent explains it if needed.
- The **Architecture Board** reads the architecture feedback across all verdicts, as evidence for improving the architecture.
