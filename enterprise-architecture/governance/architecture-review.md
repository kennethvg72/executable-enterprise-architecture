# Reviewing the architecture itself

Code gets refactored, and the architecture needs the same treatment. Left alone, it accumulates contradictions, duplicate rules, obsolete patterns, and rules whose original reason has disappeared.

## Every quarter

The Board asks an agent (preferably on a different model from the one used last time) to review the whole architecture and propose changes. The agent looks for:

1. **Contradictions** between rules, within one architecture or across the central, network, infrastructure and platform architectures.
2. **Duplication**: two rules saying the same thing in different words, which will drift apart.
3. **Rules without a working reason**: the "Why" no longer holds, for example because a product was retired or a threat disappeared.
4. **Rules that cause friction without value**, using evidence from verdicts, escalations and exceptions. Which rules cause the most rejections, and were those rejections worth it?
5. **`review` rules that should be `test` rules** ([AGT-10](../principles/ai-agents.md#agt-10-deterministic-where-it-must-be)). If agents keep judging a rule the same way, it can probably be checked deterministically.
6. **Unenforced rules**: rules that no check covers and no review cites.
7. **Gaps**: recurring Governance Agent findings that start with "no rule covers this, but...".
8. **Anti-patterns**: findings that recur across verdicts, reviews and escalations become entries in the [catalog](../anti-patterns.md), each citing the rule it breaks and with a sample in the [regression set](../pipeline/regression/README.md). An entry that can be recognized mechanically becomes a check instead ([AGT-10](../principles/ai-agents.md#agt-10-deterministic-where-it-must-be)), and one that recurs in spite of the catalog suggests the rule, or the platform's template, should change.
9. **Simplification**: rules, defaults or components that could be removed ([SIM-08](../principles/simplicity.md#sim-08-simplification-is-normal-work)).

The agent writes its findings as a proposal. The Board reviews it, decides, and the accepted changes become a new version.

## Every year, before the filing season

The Board reviews the [accumulated complexity](../landscape/accumulated-complexity.md) list with Central IT. For each item: is it smaller than last year? If not, why not? What is the plan?
