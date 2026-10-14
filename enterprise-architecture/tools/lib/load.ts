import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import type { Exception, Landscape, Manifest, Model, Service } from './model.ts';

/** The repository root, two levels above enterprise-architecture/tools/lib. */
export const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

export function readYaml<T>(path: string): T {
  return parse(readFileSync(path, 'utf8')) as T;
}

export function loadLandscape(root = REPO_ROOT): Landscape {
  return readYaml<Landscape>(join(root, 'enterprise-architecture', 'landscape', 'landscape.yaml'));
}

export function loadManifest(appDir: string): Manifest {
  const path = join(appDir, 'architecture.yaml');
  if (!existsSync(path)) throw new Error(`No architecture.yaml in ${appDir}`);
  return readYaml<Manifest>(path);
}

export interface VersionEntry {
  version: string;
  status: 'proposed' | 'active' | 'deprecated' | 'decommissioned' | 'withdrawn';
  'decommission-date'?: string;
}

export function loadVersions(root = REPO_ROOT): Record<string, VersionEntry[]> {
  const file = readYaml<{ architectures: Record<string, VersionEntry[]> }>(
    join(root, 'enterprise-architecture', 'governance', 'versions.yaml'),
  );
  return file.architectures;
}

export interface Platform {
  platform: string;
  'runs-on': 'datacenters' | 'saas' | 'devices';
  'resilience-classes': string[];
  'max-classification': string;
  exposure: string[];
  'data-stores': string[];
  dependencies: string;
  /** How the pipeline installs the candidate's dependencies itself, from its lockfile, without running install scripts (SEC-13). */
  install?: string;
  /** Every check is mandatory unless marked optional: a mandatory check that can't run makes the stage INCOMPLETE. */
  checks: { name: string; rule: string; run: string; needs: string; database?: boolean; optional?: boolean }[];
  'required-evidence'?: string[];
}

/** A platform's limits (platforms/<name>/platform.yaml), or undefined if there is no such platform. */
export function loadPlatform(name: string, root = REPO_ROOT): Platform | undefined {
  const file = join(root, 'platforms', name, 'platform.yaml');
  return existsSync(file) ? readYaml<Platform>(file) : undefined;
}

export function loadExceptions(root = REPO_ROOT): Exception[] {
  return readYaml<{ exceptions: Exception[] | null }>(
    join(root, 'enterprise-architecture', 'governance', 'exceptions.yaml'),
  ).exceptions ?? [];
}

export interface Person {
  id: string;
  name: string;
  title: string;
  status: 'active' | 'left';
}

export function loadDirectory(root = REPO_ROOT): Person[] {
  return readYaml<{ people: Person[] }>(
    join(root, 'enterprise-architecture', 'landscape', 'workforce-directory.yaml'),
  ).people;
}

/** Turn an application's manifest and its placement into a landscape service. */
export function serviceFromManifest(manifest: Manifest, instances: Service['instances'], source: string): Service {
  return {
    id: manifest.application,
    kind: 'application',
    description: manifest.description,
    class: manifest.resilience.class,
    owner: manifest['problem-owner'],
    instances,
    provides: manifest.provides ?? [],
    consumes: manifest.consumes ?? [],
    'peak-vcpu': manifest.runtime['peak-vcpu'],
    source,
  };
}

/**
 * Load the landscape and merge in every placed application. Pass `landscape` to work on a
 * modified copy (tests do this to show what a bad change would do).
 */
/**
 * An application that Central IT hasn't placed yet, with provisional addresses, so its
 * Development Agent can check network and infrastructure intent before its first release.
 * The addresses come from a range Central IT never allocates (10.<site>.20.240 and up).
 */
export function withApplications(model: Model, appDirs: string[]): Model {
  appDirs.forEach((dir, n) => {
    const manifest = loadManifest(resolve(dir));
    // Only applications in NATAX's datacenters have hosts there. Power Apps reach NATAX through the
    // data gateway, Android apps through published APIs: those are in the landscape already.
    if (loadPlatform(manifest.runtime.technology)?.['runs-on'] !== 'datacenters') return;
    model.manifests.set(manifest.application, { dir: resolve(dir), manifest });
    if (model.services.has(manifest.application)) return; // registered: keep the landscape's entry
    const instances = manifest.runtime.sites.flatMap((site, s) => Array.from({ length: manifest.runtime['instances-per-site'] }, (_, i) => ({
      site, address: `10.${site === 'dc2' ? 2 : site === 'dc1' ? 1 : 9 + s}.20.${240 + n * 4 + i}`,
    })));
    model.manifests.set(manifest.application, { dir: resolve(dir), manifest });
    model.services.set(manifest.application, serviceFromManifest(manifest, instances, `${dir}/architecture.yaml (provisional placement)`));
  });
  return model;
}

/** `--app <dir>` arguments, for the command-line tools. */
export function appArgs(argv = process.argv): string[] {
  return argv.flatMap((a, i) => (a === '--app' && argv[i + 1] ? [argv[i + 1]!] : []));
}

export function loadModel(root = REPO_ROOT, landscape = loadLandscape(root)): Model {
  const services = new Map<string, Service>();
  for (const [id, s] of Object.entries(landscape.services)) {
    services.set(id, { ...s, id, source: 'enterprise-architecture/landscape/landscape.yaml' });
  }
  const manifests = new Map<string, { dir: string; manifest: Manifest }>();
  for (const [id, placement] of Object.entries(landscape.placements ?? {})) {
    const dir = join(root, placement.path);
    const manifest = loadManifest(dir);
    if (manifest.application !== id) {
      throw new Error(`Placement ${id} points to ${placement.path}, whose manifest is for ${manifest.application}`);
    }
    manifests.set(id, { dir, manifest });
    services.set(id, serviceFromManifest(manifest, placement.instances, `${placement.path}/architecture.yaml`));
  }
  return { root, landscape, services, manifests };
}

/** A deep copy, for tests that want to break something without touching the files. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}
