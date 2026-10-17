# NATAX Enterprise Architecture

This is the central architecture. It sets the principles that every NATAX solution follows, whatever its platform. Two more architectures always apply too: [network](../network/README.md) (Zero Trust) and [infrastructure](../infrastructure/README.md) (availability, load balancing, capacity). The Problem Owner then chooses a [platform](../platforms/README.md) (TypeScript web, Power Apps or Android), whose architecture describes how that platform meets all of these. Platform and domain architectures can add rules; they can't relax these ones.

| Always applies | Chosen per application, by the Problem Owner |
|---|---|
| This central architecture, [network](../network/README.md), [infrastructure](../infrastructure/README.md) | One [platform](../platforms/README.md): [typescript-web](../platforms/typescript-web/README.md), [power-apps](../platforms/power-apps/README.md) or [android](../platforms/android/README.md) |

Version: see [VERSION](VERSION). Status of every version: [governance/versions.yaml](governance/versions.yaml).

## Contents

| Folder | What it holds |
|---|---|
| [principles/](principles/) | The rules. One file per concern, each rule with an ID, a rationale and how it is verified. |
| [anti-patterns.md](anti-patterns.md) | How the rules are usually broken, recognizably, and what to do instead. Each one cites its rule and has a sample the Governance Agent must reject. |
| [agents/](agents/README.md) | The roles, human and AI, and their rules of engagement. Who can overrule whom (mostly: nobody). |
| [pipeline/](pipeline/README.md) | The central release pipeline: the only way to change production. |
| [governance/](governance/README.md) | How this architecture changes: the Architecture Board, versions, escalations, exceptions. |
| [landscape/](landscape/README.md) | NATAX itself: [every application](landscape/landscape.md) (read before building anything), sites, network, accumulated complexity. |
| [templates/](templates/) | Files that applications copy: the architecture manifest, decision records, escalations. |
| [tools/](tools/) | Deterministic checks the pipeline runs against these rules. |

## Principles

| Prefix | File | In one line |
|---|---|---|
| SIM | [simplicity.md](principles/simplicity.md) | Every component must earn its place. |
| OWN | [ownership.md](principles/ownership.md) | Every application has a named owner. No owner means decommission. |
| SEC | [security.md](principles/security.md) | Only the pipeline changes production. Nothing is trusted by location. |
| IAM | [identity-and-access.md](principles/identity-and-access.md) | Every person and workload has its own identity. No standing privilege. |
| DAT | [data.md](principles/data.md) | Collect less, copy less, never use production data outside production. |
| RES | [resilience.md](principles/resilience.md) | Specify the service's resilience, not products. Test it, don't assert it. |
| INT | [integration.md](principles/integration.md) | Integrate through owned APIs, never through someone else's database. |
| OBS | [observability.md](principles/observability.md) | If it can't be observed, it can't be operated. |
| DEL | [delivery.md](principles/delivery.md) | Every change is a release candidate with evidence. |
| AGT | [ai-agents.md](principles/ai-agents.md) | Agents have separate duties, no production rights, and read-only access to architecture. |

## How rules are written

Every rule has the same shape:

```markdown
### SEC-03: Secrets never live in repositories
**Rule.** What must be true, stated so that it can be checked.
**Why.** The reason. When the reason is gone, the rule should go too.
**Verified by.** `test`, `review` or both, and how.
```

- **`test`** means a deterministic check enforces the rule: a test, a policy, a script. The check gives the same answer every time and needs no AI to run.
- **`review`** means an agent (or a human) judges compliance. Judgment is needed where rules involve intent, proportionality or design quality.
- **Every rule is mandatory**, unless it says "should" or "by default". Those set a default; deviating from one requires a [decision record](templates/decision-record.md) that the Governance Agent reviews. Optional things don't get rules.

Rule IDs are stable. A rule that is removed keeps its ID retired, so old decision records still make sense.

## Platform architectures

Every platform architecture ([platforms/](../platforms/README.md)) has the same parts:

- **`platform.yaml`**: what the platform is for, and its limits (resilience classes, data classification, exposure, data stores), plus the deterministic checks the pipeline runs. The limits are enforced on every release.
- **Standards**: how the platform meets every central principle, and the network and infrastructure architectures. They add rules and never relax them.
- **Approved defaults**: the dependencies (or, for Power Apps, connectors) that [SIM-01](principles/simplicity.md#sim-01-every-component-must-earn-its-place) and [SIM-05](principles/simplicity.md#sim-05-one-default-per-need) are checked against.
- **`BOOTSTRAP.md`**: the platform's part of the [bootstrap](../BOOTSTRAP.md). Bootstrap is complete only when the environment *demonstrably* works. An installer exiting successfully doesn't count.
- **`agents/`**: additions to the [agent roles](agents/README.md) for the platform.
- **`template/`**: where a new application's repository starts.
- **A version** of its own, in [versions.yaml](governance/versions.yaml).

Network and infrastructure are architectures of the same kind, but not chosen: they apply to every application. Each architecture is owned by the specialists for it, who define what "correct" looks like. The Architecture Board approves its versions.

## How this architecture is used

1. **Applications pin versions.** Each application's `architecture.yaml` ([template](templates/architecture.yaml)) records which version of this architecture, of network and infrastructure, and of its platform's architecture governs it.
2. **Agents read it, they don't edit it.** Development, Local Governance and Test Agents treat these files as read-only. If a rule can't be met, the Development Agent [escalates](governance/escalation.md) instead of working around it.
3. **The pipeline enforces it.** The [Governance Agent](agents/governance-agent.md) reviews every release candidate against the versions the application declares, and the deterministic [tools](tools/) check what can be checked mechanically.
4. **Engineering challenges it.** When a rule turns out to be wrong, impractical or obsolete, that is useful information. See [governance](governance/README.md).

## Precedence

When rules conflict: this central architecture wins over the network, infrastructure and platform architectures, and security and legal requirements win over everything else. A conflict is itself a defect: report it to the Architecture Board as an [escalation](governance/escalation.md).
