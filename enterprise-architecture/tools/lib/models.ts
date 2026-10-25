// The AI models the central agents run on, as pinned in pipeline/models.yaml (AGT-11), and the
// one way the tools ask them something: without a conversation, read-only, and recorded.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REPO_ROOT, readYaml } from './load.ts';

export interface Pin {
  provider: string;
  model: string;
  regression?: string;   // the regression set's passing result for exactly this provider and model
}

export const MODELS = join(REPO_ROOT, 'enterprise-architecture', 'pipeline', 'models.yaml');

/**
 * The pinned model of a central agent, or why there is none to use. A pin needs an exact
 * provider and model, and a regression result that names them and passed. Nothing else counts.
 */
export function pinnedModel(agent: string, file = MODELS, root = REPO_ROOT): { pin?: Pin; problem?: string } {
  const pin = readYaml<Record<string, Partial<Pin> | undefined>>(file)[agent];
  const exact = (v: unknown) => typeof v === 'string' && v.trim() !== '' && !v.includes('<');
  if (!pin || !exact(pin.provider) || !exact(pin.model)) return { problem: `No exact model is pinned for the ${agent} in models.yaml.` };
  if (!(pin.provider! in PROVIDERS)) return { problem: `There is no way to ask provider "${pin.provider}"; known: ${Object.keys(PROVIDERS).join(', ')}.` };
  const result = pin.regression ? resolve(root, pin.regression) : undefined;
  if (!result || !existsSync(result)) return { problem: `${pin.provider} ${pin.model} has no regression result on record: run regression.ts before pinning it.` };
  const text = readFileSync(result, 'utf8');
  if (!new RegExp(`^Model: ${escape(pin.provider!)} ${escape(pin.model!)}$`, 'm').test(text)) return { problem: `The regression result on record (${pin.regression}) is for another model than ${pin.provider} ${pin.model}.` };
  if (!/^Result: pass$/m.test(text)) return { problem: `${pin.provider} ${pin.model} didn't pass the regression set (${pin.regression}).` };
  return { pin: pin as Pin };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One question to a model, and everything needed to show later what was asked and answered. */
export interface Answer { text: string; transcript: string; tool: string }
export type Ask = (prompt: string, cwd: string) => Promise<Answer>;

/** Run a command with input, without a shell, and collect its output. */
export function run(cmd: string, args: string[], input: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); done({ code: null, stdout, stderr: String(e) }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

/** The Codex CLI: CODEX if set, else the newest desktop install, else whatever "codex" is on PATH. */
function codexExecutable(): string {
  if (process.env.CODEX) return process.env.CODEX;
  const base = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin');
  const found = existsSync(base)
    ? readdirSync(base).map((d) => join(base, d, 'codex.exe')).filter((f) => existsSync(f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  return found[0] ?? 'codex';
}

/**
 * OpenAI's models through the Codex CLI, sandboxed read-only, without the user's own configuration,
 * rules or hooks: the gate is the same whoever's machine it runs on.
 */
function codex(model: string): Ask {
  return async (prompt, cwd) => {
    const exe = codexExecutable();
    const out = join(mkdtempSync(join(tmpdir(), 'answer-')), 'answer.md');
    const r = await run(exe, ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '-s', 'read-only', '-m', model, '-C', cwd, '--json', '-o', out, '-'], prompt, 30 * 60 * 1000);
    const tool = spawnSync(exe, ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'codex';
    if (r.code !== 0 || !existsSync(out)) throw new Error(`${tool} failed (exit ${r.code}): ${r.stderr.trim().split('\n').slice(-3).join(' ')}`);
    return { text: readFileSync(out, 'utf8'), transcript: r.stdout, tool };
  };
}

export const PROVIDERS: Record<string, (model: string) => Ask> = { 'openai-codex': codex };
