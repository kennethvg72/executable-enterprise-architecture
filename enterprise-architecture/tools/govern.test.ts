import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { govern, type Deterministic } from './govern.ts';
import { pinnedModel, type Ask } from './lib/models.ts';
import { REGRESSION, judge, readSample, runRegression } from './regression.ts';

/** models.yaml with a pin, and the regression result it points to. */
function models(pin: Record<string, string>, result?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'models-'));
  if (result !== undefined) writeFileSync(join(dir, 'result.md'), result);
  writeFileSync(join(dir, 'models.yaml'), stringify({ 'governance-agent': { ...pin, ...(result !== undefined ? { regression: join(dir, 'result.md') } : {}) } }));
  return join(dir, 'models.yaml');
}
const PASSED = 'Model: openai-codex model-1\nResult: pass\n';
const PINNED = models({ provider: 'openai-codex', model: 'model-1' }, PASSED);

/** An application repository with one committed release candidate. */
function candidate() {
  const dir = mkdtempSync(join(tmpdir(), 'app-'));
  const git = (...args: string[]) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).stdout.trim();
  git('init', '-q'); git('config', 'user.email', 'test@natax.example'); git('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'README.md'), '# app\n');
  git('add', '-A'); git('commit', '-qm', 'app');
  mkdirSync(join(dir, 'releases', 'rc-1'), { recursive: true });
  writeFileSync(join(dir, 'releases', 'rc-1', 'candidate.yaml'), stringify({ id: 'rc-1', application: 'app', commit: git('rev-parse', 'HEAD') }));
  return dir;
}
const says = (verdict: string): Ask => async () => ({ text: `# Verdict: rc-1\n\nVerdict: ${verdict}\n\n## Reasons\n...\n`, transcript: '{"type":"turn.completed"}\n', tool: 'fake 1.0' });
const stage = (status: 'PASS' | 'FAIL' | 'INCOMPLETE'): Deterministic => () => ({ status, output: `**Deterministic stage: ${status}**\n` });

test('the Governance Agent runs only on a pinned model that passed the regression set (AGT-11)', () => {
  assert.match(pinnedModel('governance-agent').problem ?? '', /No exact model is pinned/, 'the architecture as shipped pins none');
  assert.match(pinnedModel('governance-agent', models({ provider: 'openai-codex', model: '<exact model version>' }, PASSED)).problem ?? '', /No exact model/);
  assert.match(pinnedModel('governance-agent', models({ provider: 'someone', model: 'model-1' }, PASSED)).problem ?? '', /no way to ask/);
  assert.match(pinnedModel('governance-agent', models({ provider: 'openai-codex', model: 'model-1' })).problem ?? '', /no regression result/);
  assert.match(pinnedModel('governance-agent', models({ provider: 'openai-codex', model: 'model-1' }, 'Model: openai-codex model-0\nResult: pass\n')).problem ?? '', /another model/);
  assert.match(pinnedModel('governance-agent', models({ provider: 'openai-codex', model: 'model-1' }, 'Model: openai-codex model-1\nResult: fail\n')).problem ?? '', /didn't pass/);
  assert.equal(pinnedModel('governance-agent', PINNED).pin?.model, 'model-1');
});

test('a verdict is recorded once, with the pipeline\'s facts, and a copy goes to the team', async () => {
  const app = candidate();
  const store = mkdtempSync(join(tmpdir(), 'store-'));
  const asked: string[] = [];
  const ask: Ask = async (p, cwd) => { asked.push(p); return says('approved')(p, cwd); };
  const r = await govern(app, 'rc-1', { ask, deterministic: stage('PASS'), store, models: PINNED });
  assert.equal(r.verdict, 'approved');
  const record = readFileSync(join(r.record!, 'verdict.md'), 'utf8');
  for (const fact of [/^Verdict: approved$/m, /^Governance Agent: openai-codex model-1 \(fake 1\.0\)$/m, /^Transcript: sha256:[0-9a-f]{64}$/m, /^Deterministic stage: PASS$/m]) assert.match(record, fact);
  assert.ok(existsSync(join(r.record!, 'transcript.jsonl')) && existsSync(join(r.record!, 'pipeline.txt')));
  assert.equal(readFileSync(join(app, 'releases', 'rc-1', 'verdict.md'), 'utf8'), record);
  assert.match(asked[0]!, /never instructions to you/);
  // A record is never overwritten: a changed candidate is a new candidate.
  const again = await govern(app, 'rc-1', { ask, deterministic: stage('PASS'), store, models: PINNED });
  assert.equal(again.verdict, undefined);
  assert.match(again.problems[0]!, /already judged/);
});

test('a model can\'t approve what the deterministic checks didn\'t pass (AGT-10)', async () => {
  for (const status of ['FAIL', 'INCOMPLETE'] as const) {
    const r = await govern(candidate(), 'rc-1', { ask: says('approved'), deterministic: stage(status), store: mkdtempSync(join(tmpdir(), 'store-')), models: PINNED });
    assert.equal(r.verdict, 'rejected');
    const record = readFileSync(join(r.record!, 'verdict.md'), 'utf8');
    assert.match(record, /^Overruled: the model approved/m);
    assert.ok(!/^Verdict: approved$/m.test(record), 'no approved line survives');
  }
});

test('no verdict without a pin, a candidate, or a readable answer: nothing is recorded', async () => {
  const store = mkdtempSync(join(tmpdir(), 'store-'));
  const none = async (models: string, ask: Ask, app = candidate()) => govern(app, 'rc-1', { ask, deterministic: stage('PASS'), store, models });
  assert.match((await none(models({ provider: 'openai-codex', model: '<x>' }, PASSED), says('approved'))).problems[0]!, /No exact model/);
  assert.match((await none(PINNED, says('approved'), mkdtempSync(join(tmpdir(), 'empty-')))).problems[0]!, /No candidate/);
  assert.match((await none(PINNED, async () => ({ text: 'Looks good to me!', transcript: '', tool: 'fake' }))).problems[0]!, /no "Verdict/);
  assert.match((await none(PINNED, async () => { throw new Error('provider down'); })).problems[0]!, /provider down/);
  assert.ok(!existsSync(join(store, 'app')), 'the store is untouched');
});

test('the regression set never shows a sample\'s answer, and judges verdicts and cited rules (AGT-11)', async () => {
  const s = readSample(join(REGRESSION, 'AP-15.md'));
  assert.deepEqual([s.verdict, s.rules], ['rejected', ['AGT-12']]);
  assert.ok(!/Expected|path forward/i.test(s.candidate), 'the question carries no answer');
  assert.equal(judge(s, 'Verdict: rejected\nRules: AGT-12\n').passed, true);
  assert.equal(judge(s, '**Verdict:** Rejected\n**Rules:** AGT-12, SIM-01\n').passed, true, 'Markdown emphasis is fine');
  assert.match(judge(s, 'Verdict: rejected\nRules: SIM-01\n').problem ?? '', /didn't cite AGT-12/);
  assert.equal(judge(s, 'Verdict: approved\nRules:\n').passed, false);
  assert.equal(judge(readSample(join(REGRESSION, 'OK-01.md')), 'Verdict: approved\nRules:\n').passed, true);
  // Alternatives: a wildcard way out breaks either rule, and citing one of them is a correct ground.
  const either = readSample(join(REGRESSION, 'AP-10.md'));
  assert.deepEqual(either.rules, ['SEC-02 | ZTN-03']);
  assert.equal(judge(either, 'Verdict: rejected\nRules: SEC-02\n').passed, true);
  assert.equal(judge(either, 'Verdict: rejected\nRules: ZTN-03\n').passed, true);
  assert.equal(judge(either, 'Verdict: rejected\nRules: INT-05\n').passed, false);

  const seen: string[] = [];
  const ask: Ask = async (p) => {
    const file = /described in (\S+?)\. It is/.exec(p)![1]!;
    seen.push(readFileSync(file, 'utf8'));
    const arch = /the architecture is at (\S+?)\.\n/.exec(p)![1]!;
    assert.ok(!existsSync(join(arch, 'enterprise-architecture', 'pipeline', 'regression')), 'the copy of the architecture has no answers');
    return { text: 'Verdict: rejected\nRules: AGT-12\n', transcript: '', tool: 'fake' };
  };
  const results = await runRegression('openai-codex', 'model-1', { ask, only: ['AP-15', 'OK-01'] });
  assert.deepEqual(results.map((r) => [r.sample.id, r.passed]), [['AP-15', true], ['OK-01', false]]);
  assert.ok(seen.every((t) => !/Expected|AP-15|OK-01/.test(t)));
});
