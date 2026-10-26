// SEC-05: container images are pinned. "latest", or no tag at all, is whatever the registry serves
// today: a different image tomorrow, unreviewed and unscanned. Every image a repository names is
// pinned to a version tag, or better, a digest.
// Usage: node enterprise-architecture/tools/check-images.ts <app-dir>
//
// It reads compose files, Dockerfiles' FROM lines and the `image:` of Kubernetes or OpenShift
// manifests, in the files Git tracks (or every file, outside Git).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fail, pass, report, type Result } from './lib/report.ts';

const SKIP_DIRS = new Set(['node_modules', '.git']);
const DOCKERFILE = /(^|[\\/])(?:Dockerfile|Containerfile)(?:\.[\w.-]+)?$|\.dockerfile$/i;
const MANIFEST = /\.ya?ml$/i;

/** Why an image reference isn't pinned, or undefined if it is: a version tag, or a digest. */
export function unpinned(ref: string): string | undefined {
  if (/\$\{?\w/.test(ref)) return 'it is a variable, so what it resolves to is unknown here';
  if (/@sha256:[0-9a-f]{64}$/.test(ref)) return undefined;
  const name = ref.split('/').pop() ?? ref;
  const tag = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : undefined;
  if (!tag) return 'it has no tag, so it means "latest"';
  if (/^(?:latest|stable|main|master|edge|nightly|lts|current)$/i.test(tag)) return `"${tag}" is whatever the registry serves today`;
  return /\d/.test(tag) ? undefined : `"${tag}" is not a version`;
}

/** The image references in one file, with their lines. */
export function imagesIn(file: string, text: string): { ref: string; line: number }[] {
  const out: { ref: string; line: number }[] = [];
  const stages = new Set<string>();
  text.split('\n').forEach((line, i) => {
    if (DOCKERFILE.test(file)) {
      const from = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
      if (!from) return;
      const ref = from[1]!;
      // "scratch" is no image, and an earlier stage of the same build is pinned by its own FROM.
      if (ref.toLowerCase() !== 'scratch' && !stages.has(ref.toLowerCase())) out.push({ ref, line: i + 1 });
      if (from[2]) stages.add(from[2].toLowerCase());
    } else if (MANIFEST.test(file)) {
      const image = /^\s*-?\s*image:\s*["']?([^\s"'#]+)/.exec(line);
      if (image) out.push({ ref: image[1]!, line: i + 1 });
    }
  });
  return out;
}

function files(dir: string): string[] {
  const tracked = spawnSync('git', ['-C', dir, 'ls-files', '-z', '--cached'], { encoding: 'utf8' });
  if (tracked.status === 0) return tracked.stdout.split('\0').filter(Boolean).map((f) => join(dir, f));
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full); else out.push(full);
    }
  };
  walk(dir);
  return out;
}

export function checkImages(dir: string): Result[] {
  const results: Result[] = [];
  let found = 0;
  for (const file of files(dir)) {
    if (!(DOCKERFILE.test(basename(file)) || MANIFEST.test(file)) || !existsSync(file)) continue;
    for (const { ref, line } of imagesIn(file, readFileSync(file, 'utf8'))) {
      found++;
      const why = unpinned(ref);
      if (why) results.push(fail('SEC-05', `${relative(dir, file)}:${line}: the image ${ref} isn't pinned: ${why}.`, 'Pin it to an exact version tag, or better, a digest (image@sha256:...), and let a reviewed change move it.'));
    }
  }
  return results.length ? results : [pass('SEC-05', found ? `All ${found} container images are pinned.` : 'No container images named.')];
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? '.');
  report(`Container images: ${dir}`, checkImages(dir));
}
