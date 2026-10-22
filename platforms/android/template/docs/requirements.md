# Requirements

The Problem Owner's intent, as it was given, in their words where possible ([AGT-12](https://github.com/kennethvg72/executable-enterprise-architecture/blob/main/enterprise-architecture/principles/ai-agents.md#agt-12-intent-stays-in-force-until-it-is-withdrawn)). The Development Agent records every request here as part of handling it; the Test Agent turns each requirement into tests; before every release candidate, the Local Governance Agent re-reads all of it against the implementation.

How this file works:

- **Append only.** Every request gets a new row, with the next ID and the date. Earlier rows are never edited or deleted.
- **A requirement stays in force until a later row withdraws it.** Silence is not deprecation: a requirement nobody withdrew still binds.
- **Withdrawing or replacing one is its own row**, starting with "Deprecates R-007:" (dropped) or "Supersedes R-007:" (replaced by this row).
- Decisions are in [decisions/](decisions/) (D-, by record number, withdrawn by "superseded by"), and escalations in `escalations/` (E-, by number, until answered).

## The problem

What problem does this application solve, for whom, and how will we know it's solved?

## Requirements log

| ID | Date | Entry | Tests |
|---|---|---|---|

## Open questions

Questions that need the Problem Owner's judgment. A question is open until "Answered by" names the requirement or decision that answers it.

| ID | Date | Question | Answered by |
|---|---|---|---|
