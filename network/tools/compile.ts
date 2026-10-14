// Compiles declared intent into enforceable policy and writes the generated artifacts.
// Usage: node network/tools/compile.ts

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, loadModel } from '../../enterprise-architecture/tools/lib/load.ts';
import type { Model } from '../../enterprise-architecture/tools/lib/model.ts';
import { compilePolicy, type Policy } from './policy.ts';
import { probePlan, renderEgressAllowlist, renderFlowTable, renderHostRuleset, renderHqRouter } from './render.ts';

export const GENERATED = join(REPO_ROOT, 'network', 'generated');

/** Every generated file, keyed by its path relative to generated/. */
export function renderAll(model: Model, policy: Policy): Map<string, string> {
  const files = new Map<string, string>();
  for (const s of model.services.values()) {
    if (!s.appliance) files.set(`nftables/${s.id}.nft`, renderHostRuleset(s, policy));
  }
  files.set('nftables/hq-router.nft', renderHqRouter(model, policy));
  files.set('egress-proxy/allowlist.yaml', renderEgressAllowlist(policy));
  files.set('flows.md', renderFlowTable(policy));
  files.set('probes.json', JSON.stringify(probePlan(model, policy), null, 0).replace(/\},\{/g, '},\n{'));
  return files;
}

if (import.meta.main) {
  const model = loadModel();
  const policy = compilePolicy(model);
  for (const p of policy.problems) {
    console.log(`${p.severity.toUpperCase()} ${p.rule}: ${p.message}\n  Path forward: ${p.fix}`);
  }
  if (policy.problems.some((p) => p.severity === 'error')) {
    console.log('\nNot generated: fix the errors above first.');
    process.exit(1);
  }
  rmSync(GENERATED, { recursive: true, force: true });
  const files = renderAll(model, policy);
  for (const [path, content] of files) {
    mkdirSync(join(GENERATED, path, '..'), { recursive: true });
    writeFileSync(join(GENERATED, path), content);
  }
  const probes = JSON.parse(files.get('probes.json')!) as { expect: string }[];
  console.log(`Compiled ${policy.flows.length} flows for ${model.services.size} services.`);
  console.log(`Wrote ${files.size} files to network/generated/, including ${probes.length} probes ` +
    `(${probes.filter((p) => p.expect === 'open').length} expected open, ${probes.filter((p) => p.expect === 'blocked').length} expected blocked).`);
}
