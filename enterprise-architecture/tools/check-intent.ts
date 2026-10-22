// AGT-12: the deterministic part of the intent-drift review. Drift itself takes judgment, so this
// checks only that the review happened, is current and covered everything:
// - a drift report exists for the candidate;
// - nothing changed the recorded intent after the commit it reviewed;
// - its inventory lists every item in force: requirements not deprecated or superseded, decisions
//   not superseded, open questions, escalations not answered.
// It also lists unresolved contradiction and letter-not-spirit findings, for the Governance Agent.
//
// Usage: node enterprise-architecture/tools/check-intent.ts <application repository> [--candidate releases/<id>]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadManifest, readYaml } from './lib/load.ts';
import { fail, pass, report, skip, warn, type Result } from './lib/report.ts';

/** Where the recorded intent lives in an application's repository. */
export const INTENT_PATHS = ['docs/requirements.md', 'docs/decisions', 'docs/escalations'];

/** The rows of the first Markdown table after a heading. */
function tableAfter(text: string, heading: string): string[][] {
  const at = text.search(new RegExp(`^## ${heading}\\s*$`, 'm'));
  if (at < 0) return [];
  const rows: string[][] = [];
  for (const line of text.slice(at).split('\n').slice(1)) {
    if (/^## /.test(line)) break;
    if (!line.startsWith('|') || /^\|\s*-/.test(line) || /^\|\s*ID\s*\|/.test(line)) continue;
    rows.push(line.split('|').slice(1, -1).map((c) => c.trim()));
  }
  return rows;
}

/** Every item of recorded intent that is in force: an item stays in force until a record withdraws it. */
export function intentInForce(appDir: string): { inForce: string[]; problems: string[] } {
  const problems: string[] = [];
  const inForce: string[] = [];
  const reqFile = join(appDir, 'docs', 'requirements.md');
  if (existsSync(reqFile)) {
    const text = readFileSync(reqFile, 'utf8');
    const rows = tableAfter(text, 'Requirements log').filter((r) => /^R-\d+$/.test(r[0] ?? ''));
    const ids = rows.map((r) => r[0]!);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) problems.push(`requirement IDs used twice: ${[...new Set(dupes)].join(', ')}`);
    // "Deprecates R-003:" or "Supersedes R-003, R-004:" withdraws them.
    const withdrawn = new Set(rows.flatMap((r) => {
      const m = /^(?:Deprecates|Supersedes) ((?:R-\d+(?:,\s*)?)+)/.exec(r[2] ?? '');
      return m ? m[1]!.split(/,\s*/).filter(Boolean) : [];
    }));
    for (const w of withdrawn) if (!ids.includes(w)) problems.push(`${w} is withdrawn, but was never recorded`);
    inForce.push(...ids.filter((id) => !withdrawn.has(id)));
    for (const q of tableAfter(text, 'Open questions').filter((r) => /^Q-\d+$/.test(r[0] ?? ''))) {
      if (!(q[3] ?? '').trim()) inForce.push(q[0]!);
    }
  }
  const records = (dir: string, prefix: string, closed: RegExp) => {
    const full = join(appDir, 'docs', dir);
    if (!existsSync(full)) return;
    for (const f of readdirSync(full).filter((x) => /^\d{4}-.+\.md$/.test(x)).sort()) {
      const status = /^Status:\s*(.+)$/m.exec(readFileSync(join(full, f), 'utf8'))?.[1] ?? '';
      if (!closed.test(status)) inForce.push(`${prefix}-${f.slice(0, 4)}`);
    }
  };
  records('decisions', 'D', /^superseded by\b/i);
  records('escalations', 'E', /^(answered|closed)\b/i);
  return { inForce, problems };
}

/** The drift report for a candidate: named in its evidence, or the latest in docs/reviews/. */
export function findDriftReport(appDir: string, candidateDir?: string): string | undefined {
  const candidate = candidateDir && existsSync(join(candidateDir, 'candidate.yaml')) ? readYaml<{ evidence?: { 'intent-drift'?: string } }>(join(candidateDir, 'candidate.yaml')) : undefined;
  const named = candidate?.evidence?.['intent-drift'];
  if (named) return existsSync(join(appDir, named)) ? join(appDir, named) : undefined;
  const reviews = join(appDir, 'docs', 'reviews');
  const found = existsSync(reviews) ? readdirSync(reviews).filter((f) => /intent-drift\.md$/.test(f)).sort() : [];
  return found.length ? join(reviews, found.at(-1)!) : undefined;
}

export function checkIntent(appDir: string, options: { candidateDir?: string | undefined } = {}): Result[] {
  const pinned = String(loadManifest(appDir).architecture?.['enterprise-architecture'] ?? '0');
  if (Number(pinned.split('.')[0]) < 2) return [pass('AGT-12', `Pins enterprise-architecture ${pinned}: the intent-drift review applies from 2.0.0.`)];

  const results: Result[] = [];
  const { inForce, problems } = intentInForce(appDir);
  for (const p of problems) results.push(fail('AGT-12', `The recorded intent is inconsistent: ${p}.`, 'Requirements are append-only: fix it with a new entry, never by editing an old one.'));
  const file = findDriftReport(appDir, options.candidateDir);
  if (!file) return [...results, fail('AGT-12', 'No intent-drift report for this candidate.', 'The Local Governance Agent re-reads the whole recorded intent against the implementation and writes the report (templates/intent-drift-report.md).')];
  const text = readFileSync(file, 'utf8');

  // Current: it reviewed the candidate's commit, or nothing changed the recorded intent since.
  const range = /^Range:\s*(\S+)\.\.(\S+)\s*$/m.exec(text);
  if (!range) results.push(fail('AGT-12', 'The drift report doesn\'t say which commits it reviewed ("Range: <first>..<last>").', 'Record the range in the report.'));
  else {
    const git = (...args: string[]) => spawnSync('git', ['-C', appDir, ...args], { encoding: 'utf8' });
    const candidate = options.candidateDir && existsSync(join(options.candidateDir, 'candidate.yaml'))
      ? readYaml<{ commit?: string }>(join(options.candidateDir, 'candidate.yaml')).commit : undefined;
    const head = git('rev-parse', '--verify', candidate ?? 'HEAD');
    if (head.status !== 0) results.push(skip('AGT-12', 'The application isn\'t a Git repository, so whether the drift report is current can\'t be shown.'));
    else if (git('rev-parse', '--verify', `${range[2]}^{commit}`).status !== 0) results.push(fail('AGT-12', `The drift report reviewed ${range[2]}, which isn't in this repository.`, 'Review again, at the candidate\'s commit.'));
    else if (git('merge-base', '--is-ancestor', range[2]!, head.stdout.trim()).status !== 0) results.push(fail('AGT-12', `The drift report reviewed ${range[2]}, which isn't part of the candidate's history.`, 'Review again, at the candidate\'s commit.'));
    else {
      const changed = git('diff', '--name-only', range[2]!, head.stdout.trim(), '--', ...INTENT_PATHS).stdout.trim();
      const uncommitted = candidate ? '' : git('status', '--porcelain', '--', ...INTENT_PATHS).stdout.trim();
      results.push(changed || uncommitted
        ? fail('AGT-12', `The recorded intent changed after the drift review (${[...changed.split('\n'), ...uncommitted.split('\n').map((l) => l.slice(3))].filter(Boolean).join(', ')}): the report is stale.`, 'Review the whole recorded intent again, at the candidate\'s commit.')
        : pass('AGT-12', `The drift report is current: nothing changed the recorded intent after ${range[2]}.`));
    }
  }

  // Complete: every item in force is in the inventory.
  const inventory = new Set(tableAfter(text, 'Inventory').map((r) => r[0]!).filter((id) => /^[RDQE]-\d+$/.test(id)));
  const missing = inForce.filter((id) => !inventory.has(id));
  results.push(missing.length
    ? fail('AGT-12', `The drift report's inventory misses ${missing.length} item(s) in force: ${missing.join(', ')}. An item stays in force until a record withdraws it.`, 'Review those items too, or withdraw them explicitly, by the Problem Owner.')
    : pass('AGT-12', `The drift report's inventory covers all ${inForce.length} items in force.`));

  // For the Governance Agent: unresolved findings it rejects for.
  const open = text.split(/^### /m).slice(1)
    .filter((f) => /^Class:\s*(contradiction|letter-not-spirit)\s*$/mi.test(f) && /^Status:\s*open\b/mi.test(f))
    .map((f) => f.split('\n')[0]!.trim());
  if (open.length) results.push(warn('AGT-12', `Unresolved contradiction or letter-not-spirit findings: ${open.join('; ')}. The Governance Agent rejects for these, with the finding's resolution as the path forward.`));
  return results;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { candidate: { type: 'string' } } });
  const appDir = resolve(positionals[0] ?? '.');
  report(`Intent (AGT-12): ${appDir}`, checkIntent(appDir, { candidateDir: values.candidate ? resolve(appDir, values.candidate) : undefined }));
}
