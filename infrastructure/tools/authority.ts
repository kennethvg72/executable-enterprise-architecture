// The authority for infrastructure configuration (DEL-06): HAProxy, in the pinned version, started
// with the generated configuration against stub backends, and observed through its behavior and
// its stats socket (the effective settings after defaults and overrides). Patroni's dynamic
// settings are proven after they are applied, on the running cluster (check-patroni-config.ts).
// The fast readers (check-output.ts) may only fail early.
//
// Needs Linux and HAProxy. Elsewhere it reports that it didn't run, and the result is INCOMPLETE.

import type { Model } from '../../enterprise-architecture/tools/lib/model.ts';
import { authorityBlockers, installedVersion, notProven, pinnedVersions } from '../../enterprise-architecture/tools/lib/authority.ts';
import type { Result } from '../../enterprise-architecture/tools/lib/report.ts';

export function infrastructureAuthority(_model: Model, _files: Map<string, string>): Result[] {
  const pinned = pinnedVersions('infrastructure');
  const blockers = authorityBlockers([
    { name: 'haproxy', pinned: pinned['haproxy']!, installed: installedVersion('haproxy', ['-v'], /version (\d+\.\d+\.\d+)/) },
  ]);
  if (blockers.length) return [notProven('DEL-06', 'The load balancer configuration', blockers)];
  return [notProven('DEL-06', 'The load balancer configuration', ['the HAProxy run is not built yet'])];
}
