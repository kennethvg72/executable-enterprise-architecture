# Proposal 2026-012: A change is a version

Architecture: enterprise-architecture, typescript-web
Proposed version: enterprise-architecture 4.1.1 (patch: a tool fix, and a check on the Board's own releases; no rule changes meaning); typescript-web 1.3.0 (minor: files as a data store, a relaxation released without a version in 4.0.0)
Proposed by: Architecture Board, on a Governance Agent's finding
Date: 2026-10-27

## Problem

The pipeline judges a candidate only against an architecture exactly as its version tag points to ([AGT-04](../../principles/ai-agents.md#agt-04-agents-read-the-architecture-they-dont-edit-it)). At 4.1.0, no candidate on any platform could pass that check: every platform differed from its tag.

- **The templates' pins.** Every release of enterprise-architecture updates the versions a new application starts from, in each platform's `template/architecture.yaml`. That file is inside the platform, so the platform then differs from its tag, while none of its rules changed. It happened in four releases.
- **One real change without a version.** 4.0.0 made files a data store (DAT-06) and added `files` to typescript-web's `data-stores`, but didn't release typescript-web.

Nothing caught either before a Governance Agent ran the check on a candidate. A release mistake reached the applications, and showed up there as a candidate that couldn't pass.

## Change

1. **A template's pins aren't the platform's text.** The check leaves out the `architecture:` pins of a template's manifest (each platform's `template/architecture.yaml`, and `templates/architecture.yaml` here). Nothing is judged against a template: it is where a new application starts. Any other change to a template's manifest, and everything else in the platform, still counts.
2. **The release check** ([release-check.ts](../../tools/release-check.ts), `npm run release-check`, also run by `npm test`): every architecture is either exactly what its version's tag points to, or a new version, registered in versions.yaml and not tagged yet. A change without a new version fails the Board's release, not a candidate weeks later. [lifecycle.md](../lifecycle.md) says so.
3. **typescript-web 1.3.0** releases its `files` data store.

## Trade-off

- **The cost:** a few lines in the pipeline, and one more check before a tag.
- **The gain:** a release that forgets a version fails where it was made, and a pin update doesn't need a release of every platform.

## Simplification

The alternative, a release of every platform with each enterprise-architecture release, would have added three versions to versions.yaml each time, for nothing that changes in them.

## Impact on the landscape

None. Applications pinning typescript-web 1.2.0 pass as if they pinned 1.3.0.

## Migration

None. Activation on 2026-10-27. enterprise-architecture 4.1.0 is superseded by 4.1.1, typescript-web 1.2.0 by 1.3.0.

---

## Board decision

Date: 2026-10-27
Decision: accepted and activated.
Reasoning: The recommendation's, accepted by the Board ("Go"): the Governance Agent's two options (release the platform, or revert) repair this one case; leaving the pins out and checking every release prevent the next.
