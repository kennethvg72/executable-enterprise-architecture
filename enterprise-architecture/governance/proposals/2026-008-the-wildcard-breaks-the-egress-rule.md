# Proposal 2026-008: The wildcard breaks the egress rule

Architecture: enterprise-architecture
Proposed version: 3.2.2 (patch: a correction; no rule changes meaning)
Proposed by: Architecture Board
Date: 2026-10-25

## Problem

The first run of the regression set (`regression.ts`, 27 samples) passed 26. The 27th, AP-10 "The wildcard way out", was rejected, as it must be, but citing [SEC-02](../../principles/security.md#sec-02-nothing-is-trusted-because-of-where-it-is), while the sample expected [INT-05](../../principles/integration.md#int-05-shared-capabilities-are-used-not-rebuilt).

That was a finding to explain before the model could be pinned ([AGT-11](../../principles/ai-agents.md#agt-11-the-ai-providers-are-governed-like-any-other-dependency)), and the explanation is the sample. INT-05 is about using shared services instead of rebuilding them, and the candidate keeps using the egress proxy. The rule a wildcard destination breaks is [ZTN-03](../../../network/standards.md#ztn-03-default-deny-inbound-and-outbound-on-every-host): the egress proxy allows each service only its declared destinations. It breaks SEC-02 as well, because the network denies everything that isn't explicitly allowed, and a wildcard isn't explicit. The model was right; the sample and the catalog were not.

## Change

1. AP-10 breaks ZTN-03 and SEC-02, in the [catalog](../../anti-patterns.md) and in its sample.
2. A sample's expected rules may name alternatives: "SEC-02 | ZTN-03" means either one is a correct ground for the rejection. Every expected rule, or one of its alternatives, must still be cited.

## Trade-off

- **The cost:** a sample with alternatives accepts more than one answer.
- **The gain:** a model isn't failed for citing the right rule. Alternatives are only for a candidate that really breaks each of them.

## Simplification

None removed.

## Impact on the landscape

None.

## Migration

None. Activation on 2026-10-25. 3.2.1 is superseded by 3.2.2. The whole regression set runs again before any model is pinned, not only AP-10.

---

## Board decision

Date: 2026-10-25
Decision: accepted and activated.
Reasoning: A regression set that fails a correct answer tests the set, not the model.
