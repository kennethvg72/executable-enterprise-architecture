// The Governance Agent, run once per release candidate (pipeline/README.md, stages 4 and 7),
// without a conversation: whoever wants the release never talks to the judge (AGT-01).
//
// Usage: node enterprise-architecture/tools/govern.ts <application repository> <candidate id> [--isolated]
//
// 1. The model must be pinned in pipeline/models.yaml and have passed the regression set twice
//    under that pin (AGT-11, regression.ts). Otherwise nothing runs.
// 2. The candidate is judged at its own commit, cloned from the application's remote: a commit
//    that isn't on the remote doesn't exist.
// 3. The deterministic stage runs first. Its result binds: a model can't approve what the checks
//    didn't pass (AGT-10).
// 4. The review runs in passes (lib/judge.ts): every `review` rule of the pinned architectures is
//    answered, with evidence, in a pass of its own handful of rules, and one pass looks across them.
//    A rule left unanswered means no verdict. The tool combines the answers; a model writes only the
//    reasons and the path forward of a rejection.
// 5. The verdict store gets the record once: the verdict, the transcripts, the deterministic output.
//    A record is never overwritten; a changed candidate is a new candidate. The team gets a copy.
//
// Exit 0 approved, 1 rejected, 3 when no verdict was reached.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT, loadManifest, readYaml } from './lib/load.ts';
import { antiPatterns, checklist, passes, rules } from './lib/checklist.ts';
import { exceptionsFor } from './lib/exceptions.ts';
import { judge, type Finding, type RuleResult } from './lib/judge.ts';
import { MODELS, PROVIDERS, pinnedModel, type Ask } from './lib/models.ts';

export type Stage = 'PASS' | 'FAIL' | 'INCOMPLETE';
export type Deterministic = (appDir: string, candidateDir: string) => { status: Stage; output: string };

const sha256 = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const ROLE = join(REPO_ROOT, 'enterprise-architecture', 'agents', 'governance-agent.md');

/** The deterministic stage, as its own process: pipeline.ts, on the clone. */
const deterministic = (isolated: boolean): Deterministic => (appDir, candidateDir) => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [join(REPO_ROOT, 'enterprise-architecture', 'tools', 'pipeline.ts'), appDir, '--candidate', candidateDir, ...(isolated ? ['--isolated'] : [])],
    { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status === 0 ? 'PASS' : r.status === 3 ? 'INCOMPLETE' : 'FAIL', output: `${r.stdout}${r.stderr}` };
};

/** The last step of a rejection: the reasons and the path forward, for what the tool already decided. */
export function rejectionPrompt(o: { id: string; status: Stage; blocking: (RuleResult | Finding)[]; candidate: string }): string {
  return `You are the Governance Agent of the central pipeline; your role is defined in ${ROLE}. The review of release candidate ${o.id} (${o.candidate}) is done, and it is rejected. Don't judge it again; write the rejection.

The deterministic stage's result: ${o.status}.${o.status !== 'PASS' ? ' That alone rejects it: a model can\'t approve what the checks didn\'t pass (AGT-10).' : ''}
${o.blocking.length ? `\nWhat the review found:\n${o.blocking.map((b) => `- ${b.rule}: ${'finding' in b ? b.finding : 'non-compliant'}. Evidence: ${b.evidence}`).join('\n')}\n` : ''}
Write two sections in Markdown, and nothing else:

## Reasons
<each blocking issue, with its rule ID>

## Path forward
<for each blocking issue, exactly what to change so the candidate would pass, in the order to do it>
`;
}

export interface Governed { verdict?: 'approved' | 'rejected'; record?: string; problems: string[] }

export async function govern(appDir: string, id: string, options: {
  ask?: Ask; deterministic?: Deterministic; store?: string; isolated?: boolean; models?: string; now?: Date;
} = {}): Promise<Governed> {
  const now = options.now ?? new Date();
  const { pin, problem } = pinnedModel('governance-agent', options.models ?? MODELS);
  if (!pin) return { problems: [problem!] };
  const candidateFile = join(appDir, 'releases', id, 'candidate.yaml');
  if (!existsSync(candidateFile)) return { problems: [`No candidate at releases/${id}/candidate.yaml.`] };
  const candidate = readYaml<{ application?: string; commit?: string }>(candidateFile);
  if (!candidate.application || !candidate.commit) return { problems: ['The candidate names no application or no commit.'] };
  const record = join(options.store ?? process.env.VERDICT_STORE ?? join(homedir(), 'verdict-store'), candidate.application, id);
  if (existsSync(record)) return { problems: [`${id} was already judged (${record}). A changed candidate is a new candidate, with a new id.`] };

  // The candidate at its commit, cloned from the application's remote: the record is the remote.
  const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8' });
  const remote = git('-C', appDir, 'remote', 'get-url', 'origin').stdout.trim();
  if (!remote) return { problems: [`${appDir} has no remote "origin": a candidate is judged from its application's remote, never from a working copy.`] };
  const work = mkdtempSync(join(tmpdir(), 'govern-'));
  const clone = join(work, 'candidate');
  if (git('clone', '-q', '--no-local', remote, clone).status !== 0) return { problems: [`The remote ${remote} couldn't be cloned.`] };
  if (git('-C', clone, 'checkout', '-q', '--detach', candidate.commit).status !== 0) {
    return { problems: [`Commit ${candidate.commit} isn't on the remote ${remote}. An unpushed commit doesn't exist: push it, then judge it.`] };
  }
  // The candidate's release folder may be newer than its commit.
  cpSync(join(appDir, 'releases', id), join(clone, 'releases', id), { recursive: true });

  const stage = (options.deterministic ?? deterministic(options.isolated ?? false))(clone, join(clone, 'releases', id));
  const pipelineFile = join(work, 'pipeline.txt');
  writeFileSync(pipelineFile, stage.output);

  // The checklist, from the architectures the candidate pins: every `review` rule, in small passes.
  let pinned: string[];
  try { pinned = Object.keys(loadManifest(clone).architecture ?? {}); } catch { return { problems: ['The candidate has no architecture.yaml, so its checklist is unknown.'] }; }
  const list = checklist(pinned);
  if (!list.length) return { problems: [`The architectures it pins (${pinned.join(', ') || 'none'}) have no review rules here.`] };
  const base = options.ask ?? PROVIDERS[pin.provider]!(pin.model);
  const ask: Ask = (prompt, cwd) => base(prompt, cwd, [REPO_ROOT]);
  const judgement = await judge({
    ask,
    passes: passes(list),
    catalog: antiPatterns(),
    known: new Set(rules().map((r) => r.id)),
    subject: {
      describe: `The release candidate is ${join(clone, 'releases', id, 'candidate.yaml')}, at commit ${candidate.commit}, in the application's repository at ${clone}. The architecture is at ${REPO_ROOT}; the versions the candidate pins are in its architecture.yaml. The deterministic stage has already run: its output is in ${pipelineFile}, and its result is ${stage.status}. Don't run the candidate's code.`,
      arch: REPO_ROOT,
      cwd: work,
      exists: (p) => [isAbsolute(p) ? p : join(clone, p), join(REPO_ROOT, p), join(work, p)].some((f) => existsSync(f)),
    },
  });
  if (judgement.problems.length) return { problems: ['The review didn\'t answer every rule on its checklist, so there is no verdict:', ...judgement.problems] };

  // The tool decides. A finding the Board has excepted, for this application, is shown and doesn't block.
  const { valid } = exceptionsFor(candidate.application, now);
  const covered = (rule: string, text: string) => valid.find((e) => e.rules.includes(rule) && text.toLowerCase().includes(e.finding.trim().toLowerCase()));
  const nonCompliant = judgement.results.filter((r) => r.result === 'non-compliant');
  const blocking = [...nonCompliant.filter((r) => !covered(r.rule, r.evidence)), ...judgement.findings.filter((f) => !covered(f.rule, `${f.finding} ${f.evidence}`))];
  const verdict = stage.status === 'PASS' && blocking.length === 0 ? 'approved' : 'rejected';

  let written = `## Approved\n\nThe deterministic stage passed, and every rule on the checklist was answered with evidence, none of them non-compliant.\n`;
  if (verdict === 'rejected') {
    const prompt = rejectionPrompt({ id, status: stage.status, blocking, candidate: candidate.application });
    try {
      const answer = await ask(prompt, work);
      judgement.exchanges.push({ pass: 'The rejection', prompt, ...answer });
      if (!/^## Path forward/m.test(answer.text)) return { problems: ['The rejection has no path forward, so there is no verdict yet: a rejection without one isn\'t complete.'] };
      written = answer.text.trim();
    } catch (e) {
      return { problems: [`The rejection couldn't be written: ${(e as Error).message}`] };
    }
  }

  // The facts are the pipeline's, not the model's: it can't know its own version or hashes.
  const transcript = judgement.exchanges.map((x) => JSON.stringify({ pass: x.pass, tool: x.tool, transcript: x.transcript })).join('\n');
  const tools = [...new Set(judgement.exchanges.map((x) => x.tool))].join('; ');
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const text = [
    `# Verdict: ${id}`,
    '',
    `Application: ${candidate.application}`,
    `Commit: ${candidate.commit}`,
    `Verdict: ${verdict}`,
    `Governance Agent: ${pin.provider} ${pin.model} (${tools})`,
    `Instructions: ${sha256(judgement.exchanges.map((x) => x.prompt).join('\n') + readFileSync(ROLE, 'utf8'))}`,
    `Transcript: ${sha256(transcript)}`,
    `Architecture: commit ${git('-C', REPO_ROOT, 'rev-parse', 'HEAD').stdout.trim()} (${pinned.map((a) => `${a} ${loadManifest(clone).architecture[a]}`).join(', ')})`,
    `Checklist: ${list.length} review rules, in ${passes(list).length} passes, and one across them`,
    `Deterministic stage: ${stage.status}`,
    `Date: ${now.toISOString()}`,
    '',
    '## Review',
    '',
    '| Rule | Result | Evidence |',
    '|---|---|---|',
    ...judgement.results.map((r) => `| ${r.rule} | ${r.result}${r.result === 'non-compliant' && covered(r.rule, r.evidence) ? ` (covered by ${covered(r.rule, r.evidence)!.id})` : ''} | ${cell(r.evidence)} |`),
    '',
    '## Across the rules',
    '',
    ...(judgement.findings.length ? judgement.findings.map((f) => `- ${f.rule}: ${f.finding} (${f.evidence})`) : ['Nothing found across the rules.']),
    '',
    written,
    '',
  ].join('\n');

  mkdirSync(record, { recursive: true });
  for (const [name, content] of [['verdict.md', text], ['transcript.jsonl', transcript], ['pipeline.txt', stage.output]] as const) {
    writeFileSync(join(record, name), content);
    chmodSync(join(record, name), 0o444);
  }
  writeFileSync(join(appDir, 'releases', id, 'verdict.md'), text);   // the team's copy; nothing reads it as the decision
  return { verdict, record, problems: [] };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { isolated: { type: 'boolean', default: false } } });
  const [app, id] = positionals;
  if (!app || !id) {
    console.error('Usage: node enterprise-architecture/tools/govern.ts <application repository> <candidate id> [--isolated]');
    process.exit(3);
  }
  const result = await govern(resolve(app), id, { isolated: values.isolated });
  for (const p of result.problems) console.log(`NO VERDICT: ${p}`);
  if (result.verdict) console.log(`Verdict: ${result.verdict}\nRecord: ${result.record}`);
  process.exitCode = result.verdict === 'approved' ? 0 : result.verdict === 'rejected' ? 1 : 3;
}
