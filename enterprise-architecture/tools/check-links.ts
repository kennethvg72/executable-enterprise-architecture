// Checks that every relative link in the repository's Markdown points to a file that exists,
// and every #anchor to a heading that exists. The architecture cross-references itself by
// rule ID; a broken link is a broken rule reference.
// Usage: node enterprise-architecture/tools/check-links.ts

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { REPO_ROOT } from './lib/load.ts';
import { fail, pass, report, type Result } from './lib/report.ts';

const SKIP = new Set(['node_modules', '.git', 'generated']);

export function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP.has(entry)) return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return entry.endsWith('.md') && entry !== 'paper.md' ? [full] : [];
  });
}

/** GitHub's heading anchors: lowercase, punctuation removed, spaces to hyphens. */
export function anchor(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

export function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  let inCode = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) inCode = !inCode;
    const m = !inCode && /^#{1,6}\s+(.*)$/.exec(line);
    if (m) anchors.add(anchor(m[1]!));
  }
  return anchors;
}

export function checkLinks(root = REPO_ROOT): Result[] {
  const results: Result[] = [];
  let count = 0;
  for (const file of markdownFiles(root)) {
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1]!;
      if (/^(https?:|mailto:)/.test(target)) continue;
      count++;
      const [path, hash] = target.split('#') as [string, string | undefined];
      const resolved = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
      const where = `${relative(root, file)} -> ${target}`;
      if (!existsSync(resolved)) {
        results.push(fail('LINKS', `Broken link: ${where}`));
      } else if (hash && statSync(resolved).isFile() && resolved.endsWith('.md') && !anchorsOf(readFileSync(resolved, 'utf8')).has(hash)) {
        results.push(fail('LINKS', `Broken anchor: ${where}`));
      }
    }
  }
  return results.length ? results : [pass('LINKS', `All ${count} relative links and anchors resolve.`)];
}

if (import.meta.main) {
  report('Links', checkLinks());
}
