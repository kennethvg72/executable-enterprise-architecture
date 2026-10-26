# Proposal 2026-009: The review in passes

Architecture: enterprise-architecture
Proposed version: 3.3.0 (minor: how the Governance Agent's review runs; no rule for applications becomes stricter)
Proposed by: Architecture Board
Date: 2026-10-26

## Problem

About sixty rules are verified by `review`: by the Governance Agent's judgment. One question about all of them at once, with a diff and the anti-pattern catalog, gets the rules that stand out checked and the rest forgotten, and the verdict doesn't say which. "Approved" reads the same either way. Three smaller problems surfaced with the first regression runs:

1. **The samples disagreed with the catalog.** Five samples expected one of the two rules their anti-pattern breaks, and the same model cited one in one run and the other in the next. The gate was flaky in a way that rewarded luck.
2. **One passing run is one run.** The second run of the same model failed a sample the first had passed.
3. **The record is the remote.** `govern.ts` cloned the candidate from a local working copy, so a commit that was never pushed could be judged, and deployed.

And the tools could ask only one provider's models.

## Change

1. **The checklist is computed, not chosen.** Every rule whose "Verified by" says `review`, in the architectures the candidate pins, read from the rule texts in the principles and standards (`tools/lib/checklist.ts`).
2. **The review runs in passes** (`tools/lib/judge.ts`): at most ten rules per pass, a file's rules together. Each pass is a fresh question with its rules' full text and the anti-patterns that break them, and answers every rule: compliant, non-compliant or not applicable, with evidence in a file that exists. One more pass looks across all the rules with the whole catalog, for what only shows in combination.
3. **Coverage is checked, not trusted.** A rule left unanswered, answered twice, or answered without evidence means no verdict.
4. **The tool decides.** Any non-compliant rule or finding the Board hasn't excepted rejects, as does a deterministic stage that didn't pass. A model writes only the reasons and the path forward of a rejection. The record lists every rule's answer.
5. **The regression set tests the passes.** Each sample goes to the passes that own its rules. Which rules an anti-pattern's sample is about is the catalog's to say, in one place: an AP- sample must have at least one of them found non-compliant, an OK- sample none, and a new kind, **MV-**, several violations in different domains, must have every one found. MV-01 is the first.
6. **Two passing runs in a row** before a model can be pinned; `models.yaml` names both results.
7. **A candidate is cloned from its application's remote**, and a commit that isn't there is refused.
8. **Claude through the Claude Code CLI** (`anthropic-claude`), next to Codex: read, grep and glob only, none of the user's settings, MCP servers or saved sessions, and the models it actually used recorded with every answer.

## Trade-off

- **The cost:** about seven model calls per verdict instead of one, in parallel; a regression run of each sample through its passes, twice, before a pin.
- **The gain:** a verdict that shows, rule by rule, what was judged and on what evidence; a forgotten rule that stops the verdict instead of passing silently; and a model that can't talk a finding away when the answers are combined.

## Simplification

The samples' own lists of expected rules are gone: the catalog is the only list.

## Impact on the landscape

None for applications. A model pinned on one passing run must pass again before it is used.

## Migration

None. Activation on 2026-10-26. 3.2.2 is superseded by 3.3.0.

---

## Board decision

Date: 2026-10-26
Decision: accepted and activated.
Reasoning: The owner: "If there are many rules, can we trust the Governance Agent to check them all? AI tends to 'forget' when there are many rules." A review that can't show what it checked can't be trusted to have checked it.
