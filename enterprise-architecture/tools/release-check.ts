// Before the Board tags a release: every architecture is either exactly what its version's tag
// points to, or a new version, registered in versions.yaml and not tagged yet. A change released
// without a new version is otherwise found only by the first candidate judged against it, which
// can't pass (AGT-04). npm test runs this on the repository itself.
//
// Usage: npm run release-check

import { spawnSync } from 'node:child_process';
import { REPO_ROOT, loadVersions } from './lib/load.ts';
import { architectureNames, changedSince, checkoutVersion } from './pipeline.ts';
import { fail, pass, report, skip, type Result } from './lib/report.ts';

export function releaseCheck(root = REPO_ROOT): Result[] {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (git('rev-parse', 'HEAD').status !== 0) return [skip('AGT-04', 'Not a Git checkout, so no version tags to compare with.')];
  const versions = loadVersions(root);
  return architectureNames(root).map((name) => {
    const version = checkoutVersion(name, root)!;
    const tag = `${name}/v${version}`;
    if (!versions[name]?.some((v) => v.version === version)) {
      return fail('AGT-04', `${name} ${version} isn't in versions.yaml.`, `Register ${name} ${version} in versions.yaml, with its status and proposal (lifecycle.md).`);
    }
    if (git('rev-parse', '-q', '--verify', `refs/tags/${tag}`).status !== 0) return pass('AGT-04', `${name} ${version} is a new version: tag it ${tag} with this release.`);
    const files = changedSince(name, tag, root);
    return files.length
      ? fail('AGT-04', `${name} changed since ${tag} (${files.slice(0, 5).join(', ')}${files.length > 5 ? ', ...' : ''}), but its VERSION is still ${version}.`, `Give ${name} a new version for the change (lifecycle.md), or revert it.`)
      : pass('AGT-04', `${name} ${version} is exactly as tagged ${tag}.`);
  });
}

if (import.meta.main) report('Release check (AGT-04)', releaseCheck());
