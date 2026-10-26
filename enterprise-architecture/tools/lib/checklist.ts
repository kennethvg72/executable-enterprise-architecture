// What the Governance Agent must judge, computed from the architecture, never chosen by a model:
// every rule whose "Verified by" says `review`, in the architectures a candidate pins, split into
// small passes. One question per pass, about a handful of rules, is one a model can answer whole.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './load.ts';

export interface Rule { id: string; title: string; text: string; file: string; architecture: string; review: boolean }
export interface Pass { name: string; rules: Rule[] }
export interface AntiPattern { id: string; title: string; text: string; breaks: string[] }

/**
 * The architecture a rule file belongs to; undefined for files that hold no rules. Rules live in
 * the principles, the standards, and the Board's own page: an example in a README or an entry in
 * the anti-pattern catalog is not a rule.
 */
export function architectureOf(file: string): string | undefined {
  if (!/(?:^enterprise-architecture\/principles\/[^/]+|\/standards|^enterprise-architecture\/governance\/architecture-board)\.md$/.test(file)) return undefined;
  const platform = /^platforms\/([^/]+)\//.exec(file)?.[1];
  if (platform) return platform;
  return ['enterprise-architecture', 'network', 'infrastructure'].find((a) => file.startsWith(`${a}/`));
}

/** Every rule, with its full text, from the Markdown files Git tracks. */
export function rules(root = REPO_ROOT): Rule[] {
  const listed = spawnSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: root, encoding: 'utf8' });
  const files = listed.status === 0 ? listed.stdout.split('\0').filter(Boolean).sort() : [];
  const out: Rule[] = [];
  for (const file of files) {
    const architecture = architectureOf(file);
    if (!architecture || !existsSync(join(root, file))) continue;
    const blocks = readFileSync(join(root, file), 'utf8').split(/^(?=#{2,3} )/m);
    for (const block of blocks) {
      const head = /^### ([A-Z]{2,4}-\d{2}): (.+)$/m.exec(block);
      if (!head || block.indexOf(head[0]) !== 0) continue;
      const verified = /^\*\*Verified by\.\*\*(.*)$/m.exec(block)?.[1] ?? '';
      out.push({ id: head[1]!, title: head[2]!.trim(), text: block.trim(), file, architecture, review: verified.includes('`review`') });
    }
  }
  return out;
}

/** The rules a candidate's review must answer: the `review` rules of the architectures it pins. */
export function checklist(pinned: string[], root = REPO_ROOT): Rule[] {
  return rules(root).filter((r) => r.review && pinned.includes(r.architecture));
}

/**
 * Small passes, in file order, at most `size` rules each: a file's rules stay together, small files
 * share a pass with the next ones, and a file larger than `size` is split evenly.
 */
export function passes(list: Rule[], size = 10): Pass[] {
  const byFile = new Map<string, Rule[]>();
  for (const r of list) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  const out: Pass[] = [];
  let open: Pass | undefined;
  for (const [file, rs] of byFile) {
    if (rs.length > size) {
      const parts = Math.ceil(rs.length / size);
      const per = Math.ceil(rs.length / parts);
      for (let i = 0; i < parts; i++) out.push({ name: `${file} (${i + 1} of ${parts})`, rules: rs.slice(i * per, (i + 1) * per) });
      open = undefined;
    } else if (open && open.rules.length + rs.length <= size) {
      open.name += `, ${file}`;
      open.rules.push(...rs);
    } else {
      open = { name: file, rules: [...rs] };
      out.push(open);
    }
  }
  return out;
}

/** The anti-pattern catalogs: the central one and every platform's. */
export function antiPatterns(root = REPO_ROOT): AntiPattern[] {
  const catalogs = [join(root, 'enterprise-architecture', 'anti-patterns.md')];
  const platforms = join(root, 'platforms');
  const listed = spawnSync('git', ['ls-files', '--', 'platforms/*/anti-patterns.md'], { cwd: root, encoding: 'utf8' });
  if (listed.status === 0) catalogs.push(...listed.stdout.split('\n').filter(Boolean).map((f) => join(root, f)));
  else if (existsSync(platforms)) catalogs.push(join(platforms, 'typescript-web', 'anti-patterns.md'));
  return catalogs.filter((c) => existsSync(c)).flatMap((c) => readFileSync(c, 'utf8').split(/^### /m).slice(1).map((block) => {
    const [heading = ''] = block.split('\n');
    const breaks = /^\*\*Breaks\.\*\* (.+)$/m.exec(block)?.[1] ?? '';
    return {
      id: heading.split(':')[0]!.trim(),
      title: heading.slice(heading.indexOf(':') + 1).trim(),
      text: `### ${block.trim()}`,
      breaks: [...breaks.matchAll(/\[([A-Z]{2,4}-\d{2})\]/g)].map((m) => m[1]!),
    };
  }));
}
