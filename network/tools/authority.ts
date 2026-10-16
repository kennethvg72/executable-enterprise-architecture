// The authority for network policy (DEL-06): the generated rulesets loaded into real nftables, in
// the pinned version, inside network namespaces, with listeners on the declared ports; the probe
// plan is then run against them. What the kernel does settles open or blocked. The fast reader
// (nft.ts) may only fail early.
//
// Needs Linux, nftables and iproute2, and root (or an unprivileged user namespace). Elsewhere it
// reports that it didn't run, and the result is INCOMPLETE.

import type { Model } from '../../enterprise-architecture/tools/lib/model.ts';
import { authorityBlockers, installedVersion, notProven, pinnedVersions } from '../../enterprise-architecture/tools/lib/authority.ts';
import type { Result } from '../../enterprise-architecture/tools/lib/report.ts';
import type { Policy } from './policy.ts';

export function networkAuthority(_model: Model, _policy: Policy, _files: Map<string, string>): Result[] {
  const pinned = pinnedVersions('network');
  const blockers = authorityBlockers([
    { name: 'nftables', pinned: pinned['nftables']!, installed: installedVersion('nft', ['--version'], /v(\d+\.\d+\.\d+)/) },
  ]);
  if (blockers.length) return [notProven('DEL-06', 'The network policy', blockers)];
  return [notProven('DEL-06', 'The network policy', ['the namespace run is not built yet'])];
}
