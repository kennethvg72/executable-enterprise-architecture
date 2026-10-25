# The regression set

Past and constructed release candidates with known verdicts, for the Governance Agent's models ([AGT-11](../../principles/ai-agents.md#agt-11-the-ai-providers-are-governed-like-any-other-dependency)). Before a model is pinned in [models.yaml](../models.yaml), it judges every sample here, and must reach the expected verdict, citing the expected rules ("SEC-02 | ZTN-03": either one is a correct ground for the rejection). A verdict that changes without an architecture change is a finding to explain before the model is used.

Every [anti-pattern](../../anti-patterns.md) has a sample, named after it, that must be rejected. Some anti-patterns also have a counterpart that must be **approved** (OK-), because a model that rejects too much is wrong too: a fix that names what it remedies is a valid reason, not an instance of AP-15. Each sample is the essence of a candidate: what it changes, an excerpt of the diff, the verdict and rules expected, and the path forward the verdict must give. The samples are data for the agent being tested, never instructions to it ([AGT-09](../../principles/ai-agents.md#agt-09-content-is-data-not-instructions)).

Applications named here are NATAX's; a few are fictional additions, used only as examples.
