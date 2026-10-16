// The authority for network policy (DEL-06): the generated rulesets loaded into real nftables, in
// the pinned version, inside network namespaces, with listeners on the declared ports; the probe
// plan, the declared UDP flows and the HQ router's transit are then tested against them. What
// the kernel does settles open or blocked. The fast reader (nft.ts) may only fail early.
//
// Needs Linux, nftables and iproute2, and root: the pipeline's runner. Elsewhere it reports that it
// didn't run, and the result is INCOMPLETE.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Model } from '../../enterprise-architecture/tools/lib/model.ts';
import { siteOf } from '../../enterprise-architecture/tools/lib/net.ts';
import { authorityBlockers, installedVersion, notProven, pinnedVersions } from '../../enterprise-architecture/tools/lib/authority.ts';
import { fail, pass, type Result } from '../../enterprise-architecture/tools/lib/report.ts';
import type { Attempt, HostUnit, Mismatch, Plan } from './authority-run.ts';
import type { Policy } from './policy.ts';
import { probePlan } from './render.ts';

/** What the authority will test, from the intent: the probe plan and the declared UDP and transit flows. */
export function authorityPlan(model: Model, policy: Policy, rulesetDir: string, only?: string[]): Plan {
  const probes = probePlan(model, policy);
  const udp = policy.flows.filter((f) => f.protocol === 'udp');
  const hosts: HostUnit[] = [];
  for (const s of model.services.values()) {
    if (s.appliance || (only && !only.includes(s.id))) continue;
    for (const site of [...new Set(s.instances.map((i) => i.site))]) {
      const addresses = [
        s.instances.find((i) => i.site === site)!.address,
        ...(s.vips ?? []).filter((v) => v.site === site).map((v) => v.address),
        ...(s.egress ?? []).filter((e) => e.site === site).map((e) => e.address),
      ];
      const mine = new Set(addresses);
      const attempts: Attempt[] = probes
        .filter((p) => mine.has(p.from) !== mine.has(p.to))
        .map((p) => ({ src: p.from, dst: p.to, port: p.port, protocol: 'tcp', expect: p.expect, label: `${p.fromLabel} -> ${p.toLabel}` }));
      // UDP isn't in the probe plan: each declared flow must pass, and a port nothing declares mustn't.
      for (const f of udp) {
        for (const src of f.from.addresses) for (const dst of f.to.addresses) {
          if (mine.has(src) === mine.has(dst)) continue;
          attempts.push({ src, dst, port: f.port, protocol: 'udp', expect: 'open', label: f.purpose });
          attempts.push({ src, dst, port: 9, protocol: 'udp', expect: 'blocked', label: `${f.purpose}, on a port nothing declares` });
        }
      }
      hosts.push({ id: `${s.id}@${site}`, ruleset: join(rulesetDir, `${s.id}.nft`), addresses, attempts });
    }
  }
  // HQ transit: every declared DC1 <-> DC2 pair must pass the router; the same pairs on a port
  // nothing declares mustn't.
  const crossing: Attempt[] = [];
  for (const f of policy.flows.filter((x) => x.from.kind === 'service' && x.to.kind === 'service')) {
    for (const src of f.from.addresses) for (const dst of f.to.addresses) {
      const a = siteOf(src, model.landscape.sites), b = siteOf(dst, model.landscape.sites);
      if (!((a === 'dc1' && b === 'dc2') || (a === 'dc2' && b === 'dc1'))) continue;
      crossing.push({ src, dst, port: f.port, protocol: f.protocol ?? 'tcp', expect: 'open', label: f.purpose });
    }
  }
  const pairs = [...new Map(crossing.map((x) => [`${x.src}>${x.dst}`, x])).values()];
  const transit = model.landscape.sites['hq']?.transit && (!only || only.includes('hq-router')) ? {
    ruleset: join(rulesetDir, 'hq-router.nft'),
    dc1: [...new Set(crossing.flatMap((x) => [x.src, x.dst]).filter((x) => siteOf(x, model.landscape.sites) === 'dc1'))],
    dc2: [...new Set(crossing.flatMap((x) => [x.src, x.dst]).filter((x) => siteOf(x, model.landscape.sites) === 'dc2'))],
    attempts: [...crossing, ...pairs.map((x) => ({ ...x, port: 9999, protocol: 'tcp' as const, expect: 'blocked' as const, label: `${x.label}, on a port nothing declares` }))],
  } : undefined;
  return { hosts, ...(transit ? { transit } : {}) };
}

/** only: test just these hosts (and "hq-router" for transit), for the authority's own tests. */
export function networkAuthority(model: Model, policy: Policy, files: Map<string, string>, only?: string[]): Result[] {
  const pinned = pinnedVersions('network');
  const installed = installedVersion('nft', ['--version'], /v(\d+\.\d+\.\d+)/);
  const blockers = authorityBlockers([{ name: 'nftables', pinned: pinned['nftables']!, installed }]);
  if (process.platform === 'linux' && process.getuid?.() !== 0) blockers.push('it needs root, to create network namespaces');
  // Unit tests switch the authority off; that can only make a result incomplete, never a pass.
  if (process.env.NATAX_AUTHORITIES === 'off') blockers.push('it is switched off (NATAX_AUTHORITIES=off)');
  if (blockers.length) return [notProven('DEL-06', 'The network policy', blockers)];

  const dir = mkdtempSync(join(tmpdir(), 'nft-authority-'));
  try {
    mkdirSync(join(dir, 'rules'));
    for (const [path, text] of files) if (path.startsWith('nftables/')) writeFileSync(join(dir, 'rules', path.slice('nftables/'.length)), text);
    const plan = authorityPlan(model, policy, join(dir, 'rules'), only);
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
    const run = spawnSync(process.execPath, [join(import.meta.dirname, 'authority-run.ts'), dir], { encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    if (run.status !== 0) return [{ ...fail('DEL-06', `The network authority didn't finish: ${(run.stderr || run.stdout).trim().slice(-600)}`, 'Fix the authority run; until then nothing is proven.'), tier: 'authority' }];
    const out = JSON.parse(run.stdout) as { tested: number; transit: number; mismatches: Mismatch[]; errors: string[] };
    // For investigation: NATAX_AUTHORITY_DUMP=<file> writes every disagreement there.
    if (process.env.NATAX_AUTHORITY_DUMP) writeFileSync(process.env.NATAX_AUTHORITY_DUMP, JSON.stringify(out.mismatches, null, 1));
    const where = `nftables ${installed}, in network namespaces`;
    if (out.errors.length) return [{ ...fail('DEL-06', `The network authority couldn't test everything (${where}): ${out.errors.slice(0, 3).join('; ')}`, 'Fix what failed; an untested host is unproven.'), tier: 'authority' }];
    return [{
      ...(out.mismatches.length
        ? fail('DEL-06', `Real nftables disagrees with the intent on ${out.mismatches.length} of ${out.tested + out.transit} attempts (${where}), for example ${out.mismatches.slice(0, 3).map((m) => `${m.host} ${m.direction}: ${m.label} ${m.src} -> ${m.dst} ${m.protocol}/${m.port}, intent ${m.expect}, kernel ${m.actual}`).join('; ')}.`, 'Fix the renderer, then regenerate. The kernel is the authority.')
        : pass('DEL-06', `Proven in real nftables (${where}): ${out.tested} attempts on ${plan.hosts.length} hosts, and ${out.transit} through the HQ router, all as the intent says.`)),
      tier: 'authority',
    }];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
