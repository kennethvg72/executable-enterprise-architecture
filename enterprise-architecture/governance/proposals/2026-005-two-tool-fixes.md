# Proposal 2026-005: Two tool fixes

Architecture: enterprise-architecture
Proposed version: 3.1.1 (patch: no rule changes meaning, the tools now do what the rules already said)
Proposed by: Architecture Board
Date: 2026-10-25

## Problem

Two defects in the 3.1.0 tools, found in use:

1. **Goals couldn't be listed in a drift report's inventory.** [AGT-12](../../principles/ai-agents.md#agt-12-intent-stays-in-force-until-it-is-withdrawn) counts goals as in force, and `check-intent.ts` requires every item in force in the inventory, but it read only R-, D-, Q- and E- rows from it. An application with a goal in force could never pass, whatever the Local Governance Agent wrote.
2. **The approved-architecture check read the wrong version.** `checkApprovedArchitecture` ([AGT-04](../../principles/ai-agents.md#agt-04-agents-read-the-architecture-they-dont-edit-it)) is given the root of the architecture to check, but took each version from the checkout it runs in. It compared the right files with the wrong tag. Its test passed only because both happened to be 1.0.0.

## Change

1. The inventory reads G- rows too.
2. The check reads each version at the root it is given.

Each fix has a test that fails without it.

## Trade-off

None: both were defects.

## Simplification

None removed.

## Impact on the landscape

Applications with goals can now pass the coverage check. Nothing that passed before fails now.

## Migration

None. Activation on 2026-10-25. 3.1.0 is superseded by 3.1.1.

---

## Board decision

Date: 2026-10-25
Decision: accepted and activated.
Reasoning: The tools must enforce the rules as written, no more and no less.
