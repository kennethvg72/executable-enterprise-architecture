# Proposal 2026-006: The judge is a command

Architecture: enterprise-architecture
Proposed version: 3.2.0 (minor: tools added; no rule becomes stricter)
Proposed by: Architecture Board
Date: 2026-10-25

## Problem

[AGT-11](../../principles/ai-agents.md#agt-11-the-ai-providers-are-governed-like-any-other-dependency) says the pipeline refuses a model that isn't pinned, that a new model passes the regression set first, and that every verdict records what produced it. None of that was a tool. The Governance Agent was "a separate session, given this instruction": a conversation. Whoever wants the release could talk to the judge, the model was whatever the session ran, and the regression set had never been run.

And the regression samples carry their own answers (the expected verdict, the rules, the path forward). A model shown a whole sample is shown the answer.

## Change

1. **`regression.ts`** runs the regression set against one provider and model. The model sees each sample's application and candidate only, next to a copy of the architecture without the regression set. It must reach the expected verdict and, for a rejection, cite every expected rule. The result names the provider and model exactly.
2. **`models.yaml`** pins, per agent, a provider, an exact model, and the passing regression result for exactly that pair.
3. **`govern.ts`** runs the Governance Agent once per candidate, as a command:
   - it refuses a model that isn't pinned with a passing result;
   - it judges the candidate at its commit, in a fresh clone;
   - it runs the deterministic stage first, and a model's approval can't pass a stage that failed or was incomplete ([AGT-10](../../principles/ai-agents.md#agt-10-deterministic-where-it-must-be));
   - it asks the model sandboxed read-only, without the user's configuration, rules or hooks;
   - it records the verdict, the transcript and the deterministic output in the verdict store once, with the facts that only the pipeline knows (model, hashes, commit), and gives the team a copy.
4. The provider it can ask today is OpenAI's, through the Codex CLI (`openai-codex`). Another provider is another adapter in `tools/lib/models.ts`.

## Trade-off

- **The cost:** a model change now takes a regression run, which takes time and tokens, before it can be pinned.
- **The gain:** the gate is the same command whoever runs it, its model is one that was tested, and its verdicts say what produced them.

## Simplification

The instruction to start a separate session and paste a prompt is gone.

## Impact on the landscape

None. Applications pinning 3.1.x pass as if they pinned 3.2.0.

## Migration

None. Activation on 2026-10-25. 3.1.1 is superseded by 3.2.0.

---

## Board decision

Date: 2026-10-25
Decision: accepted and activated.
Reasoning: A gate that is a conversation is a gate that can be talked to.
