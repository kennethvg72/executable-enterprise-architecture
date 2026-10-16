// What the authority checks share: the pinned versions of the software that runs production, and
// finding out whether that software, in that version, is here (DEL-06).

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT, readYaml } from './load.ts';
import { skip, type Result } from './report.ts';

/** The pinned versions for an architecture (network/runtime-versions.yaml, infrastructure/...). */
export function pinnedVersions(architecture: 'network' | 'infrastructure'): Record<string, string> {
  const raw = readYaml<Record<string, string | number>>(join(REPO_ROOT, architecture, 'runtime-versions.yaml'));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
}

/** The installed version of a tool, if it runs at all. */
export function installedVersion(command: string, args: string[], pattern: RegExp): string | undefined {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 });
  if (r.error || r.status !== 0) return undefined;
  return pattern.exec(`${r.stdout}${r.stderr}`)?.[1];
}

/** True when the installed version is the pinned one: exact, or the same major.minor when that is what's pinned. */
export const matchesPin = (installed: string, pinned: string) => installed === pinned || installed.startsWith(`${pinned}.`);

/**
 * Whether the authority can run here, as a list of reasons it can't. An empty list means every
 * tool is present in its pinned version.
 */
export function authorityBlockers(tools: { name: string; pinned: string; installed: string | undefined }[], needsLinux = true): string[] {
  const reasons: string[] = [];
  if (needsLinux && process.platform !== 'linux') reasons.push(`it needs Linux, and this is ${process.platform}`);
  for (const t of tools) {
    if (!t.installed) reasons.push(`${t.name} ${t.pinned} isn't installed`);
    else if (!matchesPin(t.installed, t.pinned)) reasons.push(`${t.name} is ${t.installed}, but production runs ${t.pinned}`);
  }
  return reasons;
}

/** The result when the authority can't run: the readers' pass is not proof, so the check is incomplete. */
export const notProven = (rule: string, what: string, reasons: string[]): Result =>
  ({ ...skip(rule, `${what} isn't proven: the authority didn't run (${reasons.join('; ')}). The fast reader found nothing wrong, which only means it can fail early.`), tier: 'authority' });
