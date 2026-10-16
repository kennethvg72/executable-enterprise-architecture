// Board exceptions (governance/escalation.md): validated, then applied. An exception that isn't
// valid covers nothing. A valid one turns the failures of exactly its rules, for exactly its
// application, into warnings that cite it: the deterministic checks take exceptions into account,
// and nothing else does.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, loadDirectory, loadExceptions } from './load.ts';
import type { Exception } from './model.ts';
import { fail, warn, type Result } from './report.ts';

const DAY_MS = 24 * 3600 * 1000;
const MAX_DAYS = 366;   // at most 12 months

/** Every rule ID defined anywhere in the architecture ("### SEC-05: ..."). */
export function ruleIds(root = REPO_ROOT): Set<string> {
  // Only files Git tracks: an untracked or ignored file planted in the checkout defines no rules.
  const listed = spawnSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: root, encoding: 'utf8' });
  const files = listed.status === 0 ? listed.stdout.split('\0').filter((f) => f && !f.includes('/template/')) : [];
  const ids = new Set<string>();
  for (const f of files) {
    if (!existsSync(join(root, f))) continue;
    for (const m of readFileSync(join(root, f), 'utf8').matchAll(/^### ([A-Z]{2,4}-\d{2}):/gm)) ids.add(m[1]!);
  }
  return ids;
}

/** Why an exception isn't valid, if it isn't. */
export function exceptionProblems(e: Exception, today: Date, root = REPO_ROOT, ids = ruleIds(root)): string[] {
  const problems: string[] = [];
  const unknown = (e.rules ?? []).filter((r) => !ids.has(r));
  if (!e.rules?.length) problems.push('it names no rules');
  if (unknown.length) problems.push(`it names rules that don't exist: ${unknown.join(', ')}`);
  if (!e.reason?.trim()) problems.push('it has no reason');
  if (!e.finding?.trim()) problems.push('it doesn\'t say which finding it covers, so it would cover every finding of its rules');
  if (!e['compensating-controls']?.trim()) problems.push('it has no compensating controls');
  const owner = loadDirectory(root).find((p) => p.id === e.owner);
  if (!owner || owner.status !== 'active') problems.push(`its owner "${e.owner}" isn't an active employee`);
  const granted = new Date(e.granted);
  const expires = new Date(e.expires);
  if (Number.isNaN(granted.getTime()) || Number.isNaN(expires.getTime())) problems.push('it has no valid granted and expires dates');
  else {
    if (granted.getTime() > today.getTime()) problems.push(`it isn't granted until ${e.granted}`);
    if ((expires.getTime() - granted.getTime()) / DAY_MS > MAX_DAYS) problems.push(`it runs for more than 12 months (${e.granted} to ${e.expires})`);
    if (expires.getTime() < today.getTime()) problems.push(`it expired on ${e.expires}`);
  }
  if (e.record && !existsSync(join(root, e.record))) problems.push(`its record ${e.record} doesn't exist`);
  return problems;
}

/** The application's exceptions that are valid today, and a failure for each one that isn't. */
export function exceptionsFor(application: string, today: Date, root = REPO_ROOT): { valid: Exception[]; problems: Result[] } {
  const ids = ruleIds(root);
  const valid: Exception[] = [];
  const problems: Result[] = [];
  for (const e of loadExceptions(root).filter((x) => x.application === application)) {
    const why = exceptionProblems(e, today, root, ids);
    if (why.length) problems.push(fail('SIM-07', `Exception ${e.id} covers nothing: ${why.join('; ')}.`, 'Ask the Architecture Board to correct it, or fix what it was meant to cover.'));
    else valid.push(e);
  }
  return { valid, problems };
}

/** The one finding a valid exception covers becomes a warning that cites it. Every other failure, of the same rule too, stays. */
export function applyExceptions(results: Result[], valid: Exception[]): Result[] {
  return results.map((r) => {
    const e = r.status === 'fail' ? valid.find((x) => x.rules.includes(r.rule) && r.message.toLowerCase().includes(x.finding.trim().toLowerCase())) : undefined;
    return e ? warn(r.rule, `${r.message} Covered by Board exception ${e.id} until ${e.expires}; compensating controls: ${e['compensating-controls'].trim()}`) : r;
  });
}
