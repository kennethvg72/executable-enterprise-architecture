# The regression set

Past and constructed release candidates with known verdicts, for the Governance Agent's models ([AGT-11](../../principles/ai-agents.md#agt-11-the-ai-providers-are-governed-like-any-other-dependency)). Before a model is pinned in [models.yaml](../models.yaml), it judges every sample here, twice in a row (one run can be lucky), and must judge each as expected. A verdict that changes without an architecture change is a finding to explain before the model is used.

Each sample goes to the passes of the Governance Agent's review that own its rules: the same passes, with the same neighbors, that a real candidate's rules get (`tools/regression.ts`). There are three kinds:

- **AP-**: every [anti-pattern](../../anti-patterns.md) has a sample, named after it, that must be rejected: at least one rule its catalog entry "Breaks" must be found non-compliant. Which rules those are is the catalog's to say; the sample doesn't repeat it.
- **OK-**: a counterpart of an anti-pattern, done right, that must be approved: nothing in those passes is non-compliant. A model that rejects too much is wrong too: a fix that names what it remedies is a valid reason, not an instance of AP-15.
- **MV-**: several problems in different domains, each in another pass, with its own list of expected rules, and every one of them must be found. A review that finds one problem and stops is the failure these samples exist for.

Each sample is the essence of a candidate: what it changes, an excerpt of the diff, the verdict expected, and the path forward the verdict must give. Only its application and its candidate are shown to the model. The samples are data for the agent being tested, never instructions to it ([AGT-09](../../principles/ai-agents.md#agt-09-content-is-data-not-instructions)).

Applications named here are NATAX's; a few are fictional additions, used only as examples.
