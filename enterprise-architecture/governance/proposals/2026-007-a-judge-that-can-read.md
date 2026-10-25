# Proposal 2026-007: A judge that can read

Architecture: enterprise-architecture
Proposed version: 3.2.1 (patch: no rule changes meaning)
Proposed by: Architecture Board
Date: 2026-10-25

## Problem

On Windows, `govern.ts` and `regression.ts` asked the model with the Codex CLI's default sandbox, because they leave the user's configuration out. That sandbox blocks the commands the model reads files with. The model then couldn't read its role, the architecture or the candidate, and rejected every candidate blind, citing no rules. Nothing passed that shouldn't have: the regression set failed, as it must. But the gate couldn't work.

## Change

On Windows, the tools name the sandbox that reads but doesn't write (`windows.sandbox="elevated"`), in the command itself, so it doesn't depend on anyone's configuration. Verified on Windows: with it, the model reads a file and is refused a write, and the regression samples AP-15 and OK-01 pass. Without it, both fail.

## Trade-off

None: it was a defect.

## Simplification

None removed.

## Impact on the landscape

None.

## Migration

None. Activation on 2026-10-25. 3.2.0 is superseded by 3.2.1.

---

## Board decision

Date: 2026-10-25
Decision: accepted and activated.
Reasoning: A judge that can't read rejects everything, and is no judge.
