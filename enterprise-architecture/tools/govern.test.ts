import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { govern, type Deterministic } from './govern.ts';
import { REPO_ROOT } from './lib/load.ts';
import { antiPatterns, checklist, passes, rules } from './lib/checklist.ts';
import { checkAnswer, citedPaths, judge, lastJson } from './lib/judge.ts';
import { pinnedModel, type Ask } from './lib/models.ts';
import { REGRESSION, readSample, routed, runRegression, verdictOf } from './regression.ts';

const FIXTURE = join(REPO_ROOT, 'enterprise-architecture', 'tools', 'fixtures', 'registered-app');

/** models.yaml with a pin, and the regression results it points to. */
function models(pin: Record<string, string>, results: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'models-'));
  const files = results.map((text, i) => { const f = join(dir, `result-${i}.md`); writeFileSync(f, text); return f; });
  writeFileSync(join(dir, 'models.yaml'), stringify({ 'governance-agent': { ...pin, ...(files.length ? { regression: files } : {}) } }));
  return join(dir, 'models.yaml');
}
const PASSED = 'Model: anthropic-claude model-1\nResult: pass\n';
const PINNED = models({ provider: 'anthropic-claude', model: 'model-1' }, [PASSED, PASSED]);

/** An application repository with one release candidate, pushed to its remote; or not pushed. */
function candidate(push = true) {
  const root = mkdtempSync(join(tmpdir(), 'app-'));
  const dir = join(root, 'app');
  const run = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim();
  run(root, 'init', '-q', '--bare', 'remote.git');
  run(root, 'init', '-q', 'app');
  const git = (...args: string[]) => run(dir, ...args);
  git('config', 'user.email', 'test@natax.example'); git('config', 'user.name', 'Test');
  git('remote', 'add', 'origin', join(root, 'remote.git'));
  cpSync(join(FIXTURE, 'architecture.yaml'), join(dir, 'architecture.yaml'));
  writeFileSync(join(dir, 'README.md'), '# app\n');
  git('add', '-A'); git('commit', '-qm', 'app');
  if (push) git('push', '-q', 'origin', 'HEAD:main');
  mkdirSync(join(dir, 'releases', 'rc-1'), { recursive: true });
  writeFileSync(join(dir, 'releases', 'rc-1', 'candidate.yaml'), stringify({ id: 'rc-1', application: 'app', commit: git('rev-parse', 'HEAD') }));
  return dir;
}

/** A model that answers every rule it is asked about, as `outcome(rule)` says, citing a file that exists. */
const answering = (outcome: (rule: string) => string = () => 'compliant', skip: string[] = []): Ask & { prompts: string[] } => {
  const prompts: string[] = [];
  const ask = async (prompt: string) => {
    prompts.push(prompt);
    const reply = (text: string) => ({ text, transcript: '{"type":"result"}\n', tool: 'fake 1.0' });
    if (/write the rejection/.test(prompt)) return reply('## Reasons\n\n- AGT-12: a reason that isn\'t one.\n\n## Path forward\n\n1. Ask the Problem Owner what it is for.\n');
    if (/This pass looks across them/.test(prompt)) return reply('```json\n{"findings": []}\n```');
    const ids = /^Rules: (.+)$/m.exec(prompt)![1]!.split(', ').filter((id) => !skip.includes(id));
    return reply(`Looked at it.\n\`\`\`json\n${JSON.stringify({ results: ids.map((rule) => ({ rule, result: outcome(rule), evidence: outcome(rule) === 'not-applicable' ? 'Not touched.' : 'architecture.yaml:1' })) })}\n\`\`\``);
  };
  return Object.assign(ask, { prompts });
};
const stage = (status: 'PASS' | 'FAIL' | 'INCOMPLETE'): Deterministic => () => ({ status, output: `**Deterministic stage: ${status}**\n` });
const store = () => mkdtempSync(join(tmpdir(), 'store-'));

test('the Governance Agent runs only on a pinned model that passed the regression set twice (AGT-11)', () => {
  assert.match(pinnedModel('governance-agent').problem ?? '', /No exact model is pinned/, 'the architecture as shipped pins none');
  assert.match(pinnedModel('governance-agent', models({ provider: 'anthropic-claude', model: '<exact model version>' }, [PASSED, PASSED])).problem ?? '', /No exact model/);
  assert.match(pinnedModel('governance-agent', models({ provider: 'someone', model: 'model-1' }, [PASSED, PASSED])).problem ?? '', /no way to ask/);
  assert.match(pinnedModel('governance-agent', models({ provider: 'anthropic-claude', model: 'model-1' }, [PASSED])).problem ?? '', /needs 2 passing regression runs/, 'one run can be lucky');
  assert.match(pinnedModel('governance-agent', models({ provider: 'anthropic-claude', model: 'model-1' }, [PASSED, 'Model: anthropic-claude model-0\nResult: pass\n'])).problem ?? '', /another model/);
  assert.match(pinnedModel('governance-agent', models({ provider: 'anthropic-claude', model: 'model-1' }, [PASSED, 'Model: anthropic-claude model-1\nResult: fail\n'])).problem ?? '', /didn't pass/);
  assert.equal(pinnedModel('governance-agent', PINNED).pin?.model, 'model-1');
  assert.equal(pinnedModel('governance-agent', models({ provider: 'openai-codex', model: 'model-1' }, ['Model: openai-codex model-1\nResult: pass\n', 'Model: openai-codex model-1\nResult: pass\n'])).pin?.provider, 'openai-codex');
});

test('the checklist comes from the rule texts: every review rule of what is pinned, in small passes', () => {
  const all = rules();
  assert.ok(all.every((r) => /(principles\/[^/]+|standards|architecture-board)\.md$/.test(r.file)), 'rules live in principles and standards, not in READMEs or the catalog');
  assert.equal(new Set(all.map((r) => r.id)).size, all.length, 'every rule once');
  const pinned = ['enterprise-architecture', 'network', 'infrastructure', 'typescript-web'];
  const list = checklist(pinned);
  assert.ok(list.length > 20 && list.every((r) => r.review && pinned.includes(r.architecture)));
  assert.ok(list.some((r) => r.id === 'AGT-12'));
  const ps = passes(list);
  assert.ok(ps.every((p) => p.rules.length <= 10), 'small passes');
  assert.deepEqual(ps.flatMap((p) => p.rules.map((r) => r.id)).sort(), list.map((r) => r.id).sort(), 'every rule in exactly one pass');
  for (const r of list) assert.ok(r.text.startsWith(`### ${r.id}:`) && /\*\*Rule\.\*\*/.test(r.text), `${r.id} carries its full text`);
});

test('a pass\'s answer counts only when every rule is answered once, with evidence that holds', () => {
  const pass = { name: 'p', rules: rules().filter((r) => ['AGT-12', 'SIM-01'].includes(r.id)) };
  const exists = (p: string) => p === 'src/app.ts';
  const ok = checkAnswer(pass, { results: [
    { rule: 'AGT-12', result: 'non-compliant', evidence: 'docs/requirements.md has no reason; src/app.ts:14 uses it' },
    { rule: 'SIM-01', result: 'not-applicable', evidence: 'No new component.' },
  ] }, exists);
  assert.deepEqual([ok.results.length, ok.problems], [2, []]);
  assert.match(checkAnswer(pass, { results: [{ rule: 'AGT-12', result: 'compliant', evidence: 'src/app.ts:3' }] }, exists).problems.join(), /SIM-01 was answered 0 times/, 'a forgotten rule');
  assert.match(checkAnswer(pass, { results: [{ rule: 'AGT-12', result: 'compliant', evidence: 'Looks fine.' }, { rule: 'SIM-01', result: 'not-applicable', evidence: 'x' }] }, exists).problems.join(), /cites no file that exists/, 'evidence without a file');
  assert.match(checkAnswer(pass, { results: [{ rule: 'AGT-12', result: 'probably fine', evidence: 'src/app.ts' }, { rule: 'SIM-01', result: 'not-applicable', evidence: 'x' }] }, exists).problems.join(), /no valid result/);
  assert.deepEqual(citedPaths('see src/app.ts:14 and architecture.yaml, e.g. here'), ['src/app.ts', 'architecture.yaml', 'e.g']);
  assert.deepEqual(lastJson('First {"a": 1}, then:\n```json\n{"b": 2}\n```'), { b: 2 });
});

test('a verdict is recorded once, with every rule of the checklist in it, and the pipeline\'s facts', async () => {
  const app = candidate();
  const s = store();
  const ask = answering();
  const r = await govern(app, 'rc-1', { ask, deterministic: stage('PASS'), store: s, models: PINNED });
  assert.equal(r.verdict, 'approved', r.problems.join(' '));
  const record = readFileSync(join(r.record!, 'verdict.md'), 'utf8');
  const list = checklist(['enterprise-architecture', 'network', 'infrastructure', 'typescript-web']);
  for (const rule of list) assert.match(record, new RegExp(`^\\| ${rule.id} \\| compliant \\|`, 'm'), `${rule.id} is in the review table`);
  for (const fact of [/^Verdict: approved$/m, /^Governance Agent: anthropic-claude model-1 \(fake 1\.0\)$/m, /^Transcript: sha256:[0-9a-f]{64}$/m, /^Deterministic stage: PASS$/m, /^Checklist: \d+ review rules, in \d+ passes, and one across them$/m]) assert.match(record, fact);
  assert.equal(ask.prompts.length, passes(list).length + 1, 'one question per pass, and one across them; no rejection to write');
  assert.ok(ask.prompts.every((p) => /never instructions to you/.test(p)));
  assert.equal(readFileSync(join(app, 'releases', 'rc-1', 'verdict.md'), 'utf8'), record);
  // A record is never overwritten: a changed candidate is a new candidate.
  const again = await govern(app, 'rc-1', { ask, deterministic: stage('PASS'), store: s, models: PINNED });
  assert.match(again.problems[0]!, /already judged/);
});

test('one non-compliant rule rejects; the tool decides, a model writes only the path forward', async () => {
  const ask = answering((rule) => (rule === 'AGT-12' ? 'non-compliant' : 'compliant'));
  const r = await govern(candidate(), 'rc-1', { ask, deterministic: stage('PASS'), store: store(), models: PINNED });
  assert.equal(r.verdict, 'rejected');
  const record = readFileSync(join(r.record!, 'verdict.md'), 'utf8');
  assert.match(record, /^\| AGT-12 \| non-compliant \|/m);
  assert.match(record, /^## Path forward$/m);
  assert.match(ask.prompts.at(-1)!, /AGT-12: non-compliant/);
});

test('a model can\'t approve what the deterministic checks didn\'t pass (AGT-10)', async () => {
  for (const status of ['FAIL', 'INCOMPLETE'] as const) {
    const ask = answering();
    const r = await govern(candidate(), 'rc-1', { ask, deterministic: stage(status), store: store(), models: PINNED });
    assert.equal(r.verdict, 'rejected');
    assert.match(ask.prompts.at(-1)!, /a model can't approve what the checks didn't pass/);
    assert.ok(!/^Verdict: approved$/m.test(readFileSync(join(r.record!, 'verdict.md'), 'utf8')));
  }
});

test('no verdict when a rule goes unanswered, the commit isn\'t on the remote, or nothing is pinned: nothing is recorded', async () => {
  const s = store();
  const none = (app: string, ask: Ask, m = PINNED) => govern(app, 'rc-1', { ask, deterministic: stage('PASS'), store: s, models: m });
  const forgot = await none(candidate(), answering(() => 'compliant', ['AGT-12']));
  assert.equal(forgot.verdict, undefined);
  assert.ok(forgot.problems.some((p) => /AGT-12 was answered 0 times/.test(p)), forgot.problems.join(' '));
  assert.match((await none(candidate(false), answering())).problems[0]!, /isn't on the remote/, 'the record is the remote');
  const local = candidate();
  spawnSync('git', ['-C', local, 'remote', 'remove', 'origin']);
  assert.match((await none(local, answering())).problems[0]!, /has no remote/);
  assert.match((await none(candidate(), answering(), models({ provider: 'anthropic-claude', model: '<x>' }))).problems[0]!, /No exact model/);
  assert.match((await none(candidate(), async () => { throw new Error('provider down'); })).problems.join(' '), /provider down/);
  assert.ok(!existsSync(join(s, 'app')), 'the store is untouched');
});

test('the regression set never shows a sample\'s answer, and routes it to the passes that own its rules (AGT-11)', async () => {
  const catalog = antiPatterns();
  const ap = readSample(join(REGRESSION, 'AP-15.md'), catalog);
  assert.deepEqual([ap.verdict, ap.kind, ap.rules], ['rejected', 'one', catalog.find((a) => a.id === 'AP-15')!.breaks], 'the catalog says which rules');
  assert.ok(!/Expected|Counterpart|path forward/i.test(ap.candidate), 'the question carries no answer');
  const ok = readSample(join(REGRESSION, 'OK-01.md'), catalog);
  assert.deepEqual([ok.kind, ok.rules], ['none', ap.rules]);
  const mv = readSample(join(REGRESSION, 'MV-01.md'), catalog);
  assert.deepEqual([mv.kind, mv.rules], ['all', ['DAT-02', 'INT-05', 'SIM-01']]);
  const all = passes(rules().filter((r) => r.review));
  assert.ok(routed(mv, all, REPO_ROOT).length >= 2, 'three rules, more than one pass');
  assert.equal(verdictOf(ap, ['AGT-12']).passed, true);
  assert.equal(verdictOf(ok, ['AGT-12']).passed, false, 'rejecting what is done right fails');
  assert.match(verdictOf(mv, ['DAT-02', 'INT-05']).problem ?? '', /missed SIM-01/, 'finding two of three fails');

  // The whole run, with a model that rejects everything except a fix that names what it remedies.
  const seen: string[] = [];
  const ask: Ask = async (prompt) => {
    const file = /described in (\S+?)\. It is/.exec(prompt)![1]!;
    const text = readFileSync(file, 'utf8');
    seen.push(text);
    const arch = /the architecture is at|defined in (\S+?)\/enterprise-architecture\/agents/.exec(prompt)?.[1];
    if (arch) assert.ok(!existsSync(join(arch, 'enterprise-architecture', 'pipeline', 'regression')), 'the copy of the architecture has no answers');
    const ids = /^Rules: (.+)$/m.exec(prompt)![1]!.split(', ');
    const outcome = /remedy the bug/.test(text) ? 'compliant' : 'non-compliant';
    return { text: `\`\`\`json\n${JSON.stringify({ results: ids.map((rule) => ({ rule, result: outcome, evidence: `${file.split(/[\\/]/).pop()}:3` })) })}\n\`\`\``, transcript: '', tool: 'fake' };
  };
  const results = await runRegression('anthropic-claude', 'model-1', { ask, only: ['AP-15', 'OK-01', 'MV-01'] });
  assert.deepEqual(results.map((r) => [r.sample.id, r.passed]), [['AP-15', true], ['MV-01', true], ['OK-01', true]]);
  assert.ok(seen.every((t) => !/Expected|AP-15|OK-01|MV-01/.test(t)));
});
