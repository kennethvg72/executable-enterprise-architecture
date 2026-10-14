// SIM-01 / SIM-05: every dependency is either an approved default of the application's
// platform, or named in one of the application's decision records. What a "dependency" is
// depends on the platform: npm packages (typescript-web), connectors (power-apps), libraries
// in the Gradle version catalog (android).
// Usage: node enterprise-architecture/tools/check-dependencies.ts <app-dir>

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT, loadManifest, loadPlatform, readYaml } from './lib/load.ts';
import { fail, pass, report, type Result } from './lib/report.ts';

type Named = { name: string; reason: string };

export function checkDependencies(appDir: string, root = REPO_ROOT): Result[] {
  const manifest = loadManifest(appDir);
  const technology = manifest.runtime.technology;
  const platform = loadPlatform(technology, root);
  if (!platform) return [fail('SIM-05', `${technology} is not a NATAX platform.`)];
  const file = join(root, 'platforms', technology, platform.dependencies);
  if (!existsSync(file)) return [fail('SIM-05', `Platform ${technology} has no ${platform.dependencies}.`)];

  if (technology === 'power-apps') return checkConnectors(manifest.runtime.connectors ?? [], readYaml<{ business: Named[]; blocked: Named[] }>(file));

  const approved = new Map(readYaml<{ dependencies: Named[] }>(file).dependencies.map((d) => [d.name, d.reason]));
  const deps = technology === 'android' ? gradleDependencies(appDir) : npmDependencies(appDir);
  if (!deps) return [pass('SIM-01', 'No dependency manifest yet, so no dependencies.')];

  const decisionsDir = join(appDir, 'docs', 'decisions');
  const decisions = existsSync(decisionsDir)
    ? readdirSync(decisionsDir).filter((f) => f.endsWith('.md')).map((f) => ({ file: f, text: readFileSync(join(decisionsDir, f), 'utf8') }))
    : [];

  const results: Result[] = [];
  for (const [name, version] of Object.entries(deps)) {
    if (version !== undefined && !/^\d+\.\d+\.\d+/.test(version)) {
      results.push(fail('SEC-05', `${name} is not pinned to an exact version ("${version}").`, 'Pin it to an exact version.'));
    }
    if (approved.has(name)) {
      results.push(pass('SIM-01', `${name}: approved default (${approved.get(name)}).`));
      continue;
    }
    const decision = decisions.find((d) => sectionMentions(d.text, 'Dependencies', name));
    results.push(decision
      ? pass('SIM-01', `${name}: reason recorded in docs/decisions/${decision.file}.`)
      : fail('SIM-01', `${name} has no recorded reason.`, `Remove it, or record why the simpler alternative isn't enough in a decision record whose "Dependencies" section names ${name}.`));
  }
  return results.length ? results : [pass('SIM-01', 'No dependencies.')];
}

function npmDependencies(appDir: string): Record<string, string> | undefined {
  const path = join(appDir, 'package.json');
  if (!existsSync(path)) return undefined;
  const pkg = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, string> | undefined>;
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

/** Libraries in the Gradle version catalog: `module = "group:artifact"` or `group = "...", name = "..."`. */
export function gradleDependencies(appDir: string): Record<string, string | undefined> | undefined {
  const path = join(appDir, 'gradle', 'libs.versions.toml');
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, 'utf8');
  const libraries = text.split(/^\[libraries\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
  const out: Record<string, string | undefined> = {};
  for (const line of libraries.split('\n')) {
    const module = /module\s*=\s*"([^"]+)"/.exec(line)?.[1]
      ?? ((g, n) => (g && n ? `${g}:${n}` : undefined))(/group\s*=\s*"([^"]+)"/.exec(line)?.[1], /name\s*=\s*"([^"]+)"/.exec(line)?.[1]);
    if (module) out[module] = undefined; // versions live in [versions]; Gradle's dependency verification pins them (AND-08)
  }
  return out;
}

function checkConnectors(connectors: string[], policy: { business: Named[]; blocked: Named[] }): Result[] {
  const business = policy.business.map((c) => c.name);
  const blocked = policy.blocked.map((c) => c.name);
  if (!connectors.length) return [pass('PA-08', 'No connectors declared.')];
  return connectors.map((c) => {
    if (business.includes(c) || (c.startsWith('NATAX ') && business.some((b) => b.startsWith('NATAX custom connectors')))) {
      return pass('PA-08', `${c}: an approved business connector.`);
    }
    return fail('PA-08', blocked.some((b) => b.split(/,\s*/).includes(c)) ? `${c} is blocked by the DLP policy.` : `${c} is not an approved connector.`,
      'Use an approved connector (platforms/power-apps/approved-connectors.yaml), or a NATAX custom connector through the data gateway. A new connector is a decision record and a change to that file, approved by Central IT.');
  });
}

/** True if the markdown section with the given heading mentions the dependency by exact name. */
export function sectionMentions(markdown: string, heading: string, name: string): boolean {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^#{2,3}\\s+${heading}\\b`, 'i').test(l));
  if (start < 0) return false;
  const level = lines[start]!.match(/^#+/)![0].length;
  const end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(l));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
  const escaped = name.replace(/[.*+?^${}()|[\]\\/@]/g, '\\$&');
  return new RegExp(`(^|[\\s\`'"(])${escaped}($|[\\s\`'",.)])`, 'm').test(body);
}

if (import.meta.main) {
  const appDir = resolve(process.argv[2] ?? '.');
  report(`Dependencies: ${appDir}`, checkDependencies(appDir));
}
