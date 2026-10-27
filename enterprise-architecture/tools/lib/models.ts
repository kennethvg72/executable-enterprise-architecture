// The AI models the central agents run on, as pinned in pipeline/models.yaml (AGT-11), and the
// one way the tools ask them something: without a conversation, read-only, and recorded.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REPO_ROOT, readYaml } from './load.ts';

export interface Pin {
  provider: string;
  model: string;
  /** The regression set's passing results for exactly this provider and model: two runs in a row. */
  regression?: string | string[];
}

export const MODELS = join(REPO_ROOT, 'enterprise-architecture', 'pipeline', 'models.yaml');

/** How many passing regression runs, for exactly the pinned model, a pin needs: one run can be lucky. */
export const RUNS_TO_PIN = 2;

/**
 * The pinned model of a central agent, or why there is none to use. A pin needs an exact
 * provider and model, and two regression results that name them and passed. Nothing else counts.
 */
export function pinnedModel(agent: string, file = MODELS, root = REPO_ROOT): { pin?: Pin; problem?: string } {
  const pin = readYaml<Record<string, Partial<Pin> | undefined>>(file)[agent];
  const exact = (v: unknown) => typeof v === 'string' && v.trim() !== '' && !v.includes('<');
  if (!pin || !exact(pin.provider) || !exact(pin.model)) return { problem: `No exact model is pinned for the ${agent} in models.yaml.` };
  if (!(pin.provider! in PROVIDERS)) return { problem: `There is no way to ask provider "${pin.provider}"; known: ${Object.keys(PROVIDERS).join(', ')}.` };
  const files = [...new Set([pin.regression ?? []].flat().map((f) => resolve(root, f)))];
  const missing = files.filter((f) => !existsSync(f));
  if (files.length < RUNS_TO_PIN || missing.length) return { problem: `${pin.provider} ${pin.model} needs ${RUNS_TO_PIN} passing regression runs on record, and has ${files.length - missing.length}: run regression.ts before pinning it.` };
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (!new RegExp(`^Model: ${escape(pin.provider!)} ${escape(pin.model!)}$`, 'm').test(text)) return { problem: `A regression result on record (${f}) is for another model than ${pin.provider} ${pin.model}.` };
    if (!/^Result: pass$/m.test(text)) return { problem: `${pin.provider} ${pin.model} didn't pass the regression set (${f}).` };
  }
  return { pin: pin as Pin };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One question to a model, and everything needed to show later what was asked and answered. */
export interface Answer { text: string; transcript: string; tool: string }
/**
 * `readable`: directories outside cwd the model may read (the architecture), never write.
 * `write`: it may also change files in cwd, and only there (start-agent.ts checks the result).
 */
export type Ask = (prompt: string, cwd: string, readable?: string[], options?: { write?: boolean }) => Promise<Answer>;

/** Run a command with input, without a shell, and collect its output. */
export function run(cmd: string, args: string[], input: string, timeoutMs: number, cwd?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], ...(cwd ? { cwd } : {}) });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); done({ code: null, stdout, stderr: String(e) }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

/** The newest file of that name in any of these folders' subfolders, by modification time. */
function newest(base: string, pattern: RegExp, file: string): string | undefined {
  if (!existsSync(base)) return undefined;
  return readdirSync(base).filter((d) => pattern.test(d)).map((d) => join(base, d, file)).filter((f) => existsSync(f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** The Codex CLI: CODEX if set, else the newest desktop install, else whatever "codex" is on PATH. */
function codexExecutable(): string {
  return process.env.CODEX ?? newest(join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin'), /./, 'codex.exe') ?? 'codex';
}

/** The Claude Code CLI: CLAUDE if set, else the newest one VS Code's extension ships, else whatever "claude" is on PATH. */
function claudeExecutable(): string {
  const shipped = newest(join(homedir(), '.vscode', 'extensions'), /^anthropic\.claude-code-/, join('resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude'));
  return process.env.CLAUDE ?? shipped ?? 'claude';
}

/**
 * OpenAI's models through the Codex CLI, sandboxed read-only (or to its workspace, when it may
 * write), without the user's own configuration,
 * rules or hooks: the gate is the same whoever's machine it runs on.
 */
function codex(model: string): Ask {
  return async (prompt, cwd, _readable, options = {}) => {
    const exe = codexExecutable();
    const out = join(mkdtempSync(join(tmpdir(), 'answer-')), 'answer.md');
    // On Windows, the sandbox has to be named: without the user's configuration, the default one
    // blocks the commands the model reads files with, and a model that can't read rejects blind.
    const windows = process.platform === 'win32' ? ['-c', 'windows.sandbox="elevated"'] : [];
    const r = await run(exe, ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', ...windows,
      '-s', options.write ? 'workspace-write' : 'read-only', '-m', model, '-C', cwd, '--json', '-o', out, '-'], prompt, 30 * 60 * 1000);
    const tool = spawnSync(exe, ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'codex';
    if (r.code !== 0 || !existsSync(out)) throw new Error(`${tool} failed (exit ${r.code}): ${r.stderr.trim().split('\n').slice(-3).join(' ')}`);
    return { text: readFileSync(out, 'utf8'), transcript: r.stdout, tool };
  };
}

/**
 * Anthropic's models through the Claude Code CLI, without a conversation: only the tools that read
 * (Read, Grep, Glob), and Edit and Write when it may write; never a shell; none of the user's
 * settings, MCP servers or saved sessions.
 */
function claude(model: string): Ask {
  return async (prompt, cwd, readable = [], options = {}) => {
    const exe = claudeExecutable();
    const tools = options.write ? ['--tools', 'Read,Grep,Glob,Edit,Write', '--permission-mode', 'acceptEdits'] : ['--tools', 'Read,Grep,Glob', '--permission-mode', 'dontAsk'];
    const r = await run(exe, ['-p', '--model', model, ...tools,
      '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json',
      ...readable.flatMap((d) => ['--add-dir', d])], prompt, 30 * 60 * 1000, cwd);
    const version = spawnSync(exe, ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'claude';
    let answer: { result?: string; is_error?: boolean; modelUsage?: Record<string, unknown> } = {};
    try { answer = JSON.parse(r.stdout); } catch { /* reported below */ }
    if (r.code !== 0 || answer.is_error || typeof answer.result !== 'string') throw new Error(`claude ${version} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`);
    // The models it actually used, as the CLI reports them: a pin is a claim, this is what happened.
    return { text: answer.result, transcript: r.stdout, tool: `claude ${version}; used ${Object.keys(answer.modelUsage ?? {}).join(', ') || model}` };
  };
}

export const PROVIDERS: Record<string, (model: string) => Ask> = { 'openai-codex': codex, 'anthropic-claude': claude };
