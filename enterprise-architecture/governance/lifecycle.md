# Architecture versions and their lifecycle

The central architecture, the network and infrastructure architectures, and each platform architecture are versioned independently, using semantic versioning:

- **Major** (2.0.0): a rule becomes stricter, or new mandatory rules are added. Existing applications may stop complying.
- **Minor** (1.1.0): rules are relaxed, removed or clarified, or guidance is added. Every application that complies with the previous version still complies.
- **Patch** (1.0.1): wording, links, typos. No rule changes meaning.

Each version is a Git tag on this repository, for example `enterprise-architecture/v1.0.0` or `typescript-web/v1.2.0`. The status of every version is in [versions.yaml](versions.yaml).

## Statuses

```
 proposed ──▶ active ──▶ deprecated ──▶ decommissioned
    │
    └──▶ withdrawn
```

| Status | Meaning |
|---|---|
| **proposed** | Under evaluation. Applications can't pin it yet. |
| **active** | The current version. New applications pin it. Only the latest version is active. An application pinning an older minor version of the same major passes as if it pinned the active one, because minor versions never make rules stricter. |
| **deprecated** | Superseded by a new major version. Applications that pin it still pass the pipeline until its `decommission-date`, but they must migrate before then. |
| **decommissioned** | No longer accepted by the pipeline. Applications still pinning it can only release a migration to a newer version (which pins that version and is judged against it), or security fixes. |
| **withdrawn** | A proposal that was not adopted. Kept for the record. |

## From proposed to active: run it against the landscape first

Before a new major version becomes active, the Board runs it against the existing landscape:

1. An agent evaluates every application in the landscape against the proposed version, using the same checks the pipeline uses, and records each conflict.
2. For each conflict, the agent estimates the change needed to comply, using today's economics for the estimate.
3. The Board reviews the results. Conflicts that reveal problems in existing applications become migration work. Conflicts that reveal problems in the proposal change the proposal.
4. The Board sets the activation date, and the decommission date of the version being replaced. The default migration window is six months, and never ends during the filing season.

## Mandatory changes

Some changes can't wait for a migration window: a security vulnerability, a legal requirement, a regulator's instruction. The Board can mark specific rules of a new version as **mandatory immediately**. The pipeline then applies those rules to every application, whatever version it pins. This is rare, and each use is recorded in `versions.yaml` with its reason.
