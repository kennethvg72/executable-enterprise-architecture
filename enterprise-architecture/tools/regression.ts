// The regression set, judged by a model before it is pinned (AGT-11, pipeline/regression/README.md).
//
// Usage: node enterprise-architecture/tools/regression.ts <provider> <model> [--only AP-15,OK-01] [--out <file>]
//
// The model sees each sample without its answer: only its application and its candidate, next to
// a copy of the architecture that leaves the regression set out. Each sample goes to the passes of
// the Governance Agent's review that own its rules (lib/judge.ts), the same passes a real candidate
// gets, and must be judged as expected:
//   AP-  an anti-pattern: at least one rule its catalog entry breaks is non-compliant;
//   OK-  its counterpart, done right: nothing in those passes is non-compliant;
//   MV-  several violations in different domains: every expected rule is non-compliant.
// The result names the provider and the model exactly; models.yaml points to two passing results
// when the model is pinned, and govern.ts checks that.
//
// Exit 0 when every sample passed, 1 when one didn't, 3 when one got no verdict at all.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT } from './lib/load.ts';
import { antiPatterns, passes, rules, type Pass } from './lib/checklist.ts';
import { judge } from './lib/judge.ts';
import { PROVIDERS, type Ask } from './lib/models.ts';

export const REGRESSION = join(REPO_ROOT, 'enterprise-architecture', 'pipeline', 'regression');

export interface Sample {
  id: string;
  application: string;
  verdict: 'approved' | 'rejected';
  /** The rules it is about: from the catalog (AP-, OK-), or its own list (MV-). */
  rules: string[];
  /** AP-: one of them; OK-: none of them; MV-: all of them. */
  kind: 'one' | 'none' | 'all';
  candidate: string;
}

/** A sample's answer and its question, apart. Only the question is ever shown to the model. */
export function readSample(file: string, catalog = antiPatterns()): Sample {
  const text = readFileSync(file, 'utf8');
  const line = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(text)?.[1]?.trim() ?? '';
  const id = basename(file, '.md');
  const verdict = line('Expected verdict');
  const candidate = /^## The candidate\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1]?.trim() ?? '';
  if ((verdict !== 'approved' && verdict !== 'rejected') || !candidate) throw new Error(`${id} has no expected verdict or no candidate section.`);
  const breaks = (ap: string) => catalog.find((a) => a.id === ap)?.breaks ?? [];
  const kind = id.startsWith('MV-') ? 'all' : id.startsWith('OK-') ? 'none' : 'one';
  const list = kind === 'all' ? line('Expected rules').split(',').map((r) => r.trim()).filter(Boolean) : breaks(kind === 'none' ? line('Counterpart of') : id);
  if (!list.length) throw new Error(`${id} names no rules: its anti-pattern breaks none, or it lists none.`);
  return { id, application: line('Application'), verdict, rules: list, kind, candidate };
}

export interface Judged { sample: Sample; verdict?: 'approved' | 'rejected'; cited: string[]; passed: boolean; problem?: string }

/** The passes a sample goes to: those that own any of its rules, as a real review would group them. */
export function routed(sample: Sample, all: Pass[], arch: string): Pass[] {
  const owning = all.filter((p) => p.rules.some((r) => sample.rules.includes(r.id)));
  // A rule that isn't a `review` rule has no pass of its own; it gets one, so it is still asked about.
  const missing = sample.rules.filter((id) => !owning.some((p) => p.rules.some((r) => r.id === id)));
  const extra = rules(arch).filter((r) => missing.includes(r.id));
  return extra.length ? [...owning, { name: `${sample.id}: rules outside the review checklist`, rules: extra }] : owning;
}

/** Was it judged as expected? */
export function verdictOf(sample: Sample, nonCompliant: string[]): Judged {
  const verdict = nonCompliant.length ? 'rejected' : 'approved';
  const found = sample.rules.filter((r) => nonCompliant.includes(r));
  const passed = sample.kind === 'one' ? found.length > 0 : sample.kind === 'none' ? nonCompliant.length === 0 : found.length === sample.rules.length;
  const problem = passed ? undefined
    : sample.kind === 'one' ? `none of ${sample.rules.join(', ')} found non-compliant`
    : sample.kind === 'none' ? `rejected what is done right (${nonCompliant.join(', ')})`
    : `missed ${sample.rules.filter((r) => !found.includes(r)).join(', ')}`;
  return { sample, verdict, cited: nonCompliant, passed, ...(problem ? { problem } : {}) };
}

export async function runRegression(provider: string, model: string, options: { ask?: Ask; only?: string[]; concurrency?: number } = {}): Promise<Judged[]> {
  const ask = options.ask ?? PROVIDERS[provider]?.(model);
  if (!ask) throw new Error(`There is no way to ask provider "${provider}".`);
  const catalog = antiPatterns();
  const files = readdirSync(REGRESSION).filter((f) => /^(?:AP|OK|MV)-.*\.md$/.test(f) && (!options.only || options.only.includes(basename(f, '.md')))).sort();
  const samples = files.map((f) => readSample(join(REGRESSION, f), catalog));

  // The architecture without its answers, and each candidate under a name that gives nothing away.
  const work = mkdtempSync(join(tmpdir(), 'regression-'));
  const arch = join(work, 'architecture');
  cpSync(REPO_ROOT, arch, { recursive: true, filter: (src) => {
    const rel = relative(REPO_ROOT, src).replace(/\\/g, '/');
    return !['node_modules', '.git', 'paper.md', 'enterprise-architecture/pipeline/regression'].some((x) => rel === x || rel.startsWith(`${x}/`));
  } });
  // No .git in the copy: its history holds the answers. The rules are read from the real checkout.
  const all = passes(rules(REPO_ROOT).filter((r) => r.review));
  const known = new Set(rules(REPO_ROOT).map((r) => r.id));

  const results: Judged[] = [];
  for (const [i, s] of samples.entries()) {
    const file = join(work, `candidate-${String(i + 1).padStart(2, '0')}.md`);
    writeFileSync(file, `# Release candidate\n\nApplication: ${s.application}\n\n${s.candidate}\n`);
    const judgement = await judge({
      ask, catalog, known, across: false, concurrency: options.concurrency ?? 3,
      passes: routed(s, all, REPO_ROOT),
      subject: {
        describe: `Judge the release candidate described in ${file}. It is the essence of a candidate, not its whole repository: what it shows is what the candidate does, and the deterministic stage found nothing beyond what it shows. Cite the description file, or the files its diff names, as evidence.`,
        arch, cwd: work,
        // Evidence may cite the description, the files its diff names, or the architecture.
        exists: (p) => [isAbsolute(p) ? p : join(work, p), join(arch, p)].some((f) => existsSync(f)) || s.candidate.includes(p),
      },
    });
    const judged = judgement.problems.length
      ? { sample: s, cited: [], passed: false, problem: `no verdict: ${judgement.problems.join(' ')}` }
      : verdictOf(s, judgement.results.filter((r) => r.result === 'non-compliant').map((r) => r.rule));
    results.push(judged);
    console.error(`${s.id}: ${judged.passed ? 'pass' : `FAIL (${judged.verdict ?? 'no verdict'}${judged.problem ? `, ${judged.problem}` : ''})`}`);
  }
  return results;
}

export function resultFile(provider: string, model: string, results: Judged[], date: Date): string {
  const passed = results.every((r) => r.passed);
  const expected = (s: Sample) => s.kind === 'none' ? 'approved' : `rejected (${s.kind === 'all' ? 'all' : 'one'} of ${s.rules.join(', ')})`;
  return [
    `# Regression result: ${provider} ${model}`,
    '',
    `Model: ${provider} ${model}`,
    `Date: ${date.toISOString().slice(0, 10)}`,
    `Samples: ${results.length}`,
    `Result: ${passed ? 'pass' : 'fail'}`,
    '',
    '| Sample | Expected | Verdict | Found non-compliant | Result |',
    '|---|---|---|---|---|',
    ...results.map((r) => `| ${r.sample.id} | ${expected(r.sample)} | ${r.verdict ?? '-'} | ${r.cited.join(', ') || '-'} | ${r.passed ? 'pass' : `fail${r.problem ? `: ${r.problem.replace(/\|/g, '/').slice(0, 300)}` : ''}`} |`),
    '',
  ].join('\n');
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { only: { type: 'string' }, out: { type: 'string' } } });
  const [provider, model] = positionals;
  if (!provider || !model) {
    console.error('Usage: node enterprise-architecture/tools/regression.ts <provider> <model> [--only AP-15,OK-01] [--out <file>]');
    process.exit(3);
  }
  const now = new Date();
  const results = await runRegression(provider, model, values.only ? { only: values.only.split(',') } : {});
  const out = resolve(values.out ?? join(REGRESSION, 'results', `${now.toISOString().slice(0, 10)}-${provider}-${model}.md`));
  if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, resultFile(provider, model, results, now));
  console.log(`${results.filter((r) => r.passed).length} of ${results.length} samples passed. Result: ${out}`);
  process.exitCode = results.every((r) => r.passed) ? 0 : results.some((r) => !r.verdict) ? 3 : 1;
}
