# Proposal 2026-010: Lessons from real use

Architecture: enterprise-architecture, infrastructure
Proposed version: enterprise-architecture 4.0.0, infrastructure 2.0.0 (major: new mandatory rules)
Proposed by: Architecture Board
Date: 2026-10-26

## Problem

The first application to adopt this architecture, after it had been built without it, found where the architecture didn't fit, where it was silent, and where its tools were wrong. Its escalations and proposals, and the Board's own backlog, came down to these:

1. **Findings had no owner but the agent that raised them.** A Problem Owner who rightly disagreed with a local agent about what the application should do could only list the finding as a risk to accept, as if the disagreement were a risk.
2. **Files weren't a data store.** DAT-06 allowed only PostgreSQL, so attachments and documents an application keeps were either undeclared, or declared and refused by the validator.
3. **No way in without the identity provider.** When the identity provider can't be reached, an application had no designed way in; one gets improvised.
4. **A backup copied a mass deletion faithfully,** night after night, until the good copies were rotated out.
5. **External services were read on every request,** making the application as slow and fragile as they are.
6. **Tool defects:** the secret scanner reported a developer's own, ignored `.env` as a secret in the repository; a shallow clone of the architecture couldn't be checked against its tags; and the IAM-04 check passed any group name without saying it couldn't check it.
7. **Lessons the Board had noted earlier:** regular expressions from users that take a service down; changes that lock out the session applying them; code that runs without a verdict, because nothing compared what runs with what was approved; four ways of breaking rules nobody had named; and unpinned container images.
8. **The regression set barely measured over-rejection:** one sample had to be approved, against fifteen that had to be rejected.

## Change

1. **AGT-02** becomes "Nobody overrules the Governance Agent, and a local finding is overruled only on the record". The Problem Owner may overrule a Test Agent or Local Governance Agent finding, with a recorded reason; the overruled finding is listed in the release candidate (`overruled`) for the Governance Agent to judge. Security Agent findings are fixed or listed as proposed accepted risks. Nobody overrules the Governance Agent.
2. **DAT-06**: files an application owns are a data store, declared as `store: files` with their path on the landscape's `file-storage`, with a classification and a retention period. `validate-manifest.ts` checks them.
3. **IAM-08 (new)**: a way in when the identity provider can't be reached: single-use, short-lived, recorded, started only through just-in-time access, never a password.
4. **INF-09 (new)**: a backup notices a mass deletion, and waits for a person's acknowledgment outside the application before removing older copies.
5. **INT-07 (new)**: data from outside is kept, and read again only at a stated interval, except reads whose point is the current state.
6. **DEL-04** extends drift detection to code: the deployed commit is compared with the last approved verdict's. **DEL-07 (new)**: a change that can lock you out reverts itself unless it is confirmed from a new session.
7. **SEC-05**: container images are pinned, checked by the new `check-images.ts` in the pipeline. **SEC-06**: regular expressions from users are bounded.
8. **Tools:** the secret scanner reads what Git tracks; BOOTSTRAP says to clone the architecture whole and leave its permissions; the IAM-04 check warns that groups can't be checked here.
9. **Anti-patterns AP-16 to AP-20**: the user's regex on the main thread, the reason the agent wrote, the socket that is root, root runs what anyone can write, the open proxy. Each has its regression sample.
10. **Approved counterparts OK-02** (of AP-01: hidden for convenience, authorized on the server) and **OK-03** (of AP-10: exact destinations through the egress proxy).

## Trade-off

- **The cost:** new mandatory rules, so a major version: applications migrate by 2027-06-01. Applications with files, external data, backups, user-supplied patterns or container images have work to do.
- **The gain:** the architecture fits what applications really do, and the gaps that an adoption found are closed for everyone.

## Simplification

The overruled finding no longer has to pose as an accepted risk.

## Impact on the landscape

Applications that keep files declare them; applications that read external services state their intervals; every repository's container images pass `check-images.ts`. The landscape declares its file storage.

## Migration

Activation on 2026-10-26. enterprise-architecture 3.x and infrastructure 1.0.0 are deprecated, and decommissioned on 2027-06-01, outside the filing season.

---

## Board decision

Date: 2026-10-26
Decision: accepted and activated.
Reasoning: An architecture learns from the applications that use it, or it describes an environment that doesn't exist. Each change here comes from something an adoption found, or the Board had already noted.
