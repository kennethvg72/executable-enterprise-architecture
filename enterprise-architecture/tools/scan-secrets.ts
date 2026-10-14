// SEC-03: a simple secret scanner. A real pipeline uses a dedicated scanner with hundreds of
// patterns and entropy analysis; this one catches the common cases and shows the principle.
// Usage: node enterprise-architecture/tools/scan-secrets.ts <dir>

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fail, pass, report, type Result } from './lib/report.ts';

const SKIP_DIRS = new Set(['node_modules', '.git']);
const MAX_FILE_BYTES = 1_000_000;
const ALLOW_MARKER = 'secret-scan: allow';

const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'private key', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/ },
  { name: 'cloud access key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'token-like assignment', regex: /\b(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i },
  // Credentials in a URL, unless the host is local (development defaults are fine).
  { name: 'credentials in URL', regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:[^\s/@'"]+@(?!localhost\b|127\.0\.0\.1\b|\[::1\])[^\s/'"]+/i },
];

export function scanSecrets(dir: string): Result[] {
  const findings: Result[] = [];
  let files = 0;
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(path, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.size <= MAX_FILE_BYTES) {
        files++;
        const lines = readFileSync(full, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (line.includes(ALLOW_MARKER)) return;
          for (const p of PATTERNS) {
            if (p.regex.test(line)) {
              findings.push(fail('SEC-03', `Possible ${p.name} in ${relative(dir, full)}:${i + 1}.`, 'Remove it, rotate the secret (treat it as compromised), and load it from the secret store at runtime.'));
            }
          }
        });
      }
    }
  };
  walk(dir);
  return findings.length ? findings : [pass('SEC-03', `No secrets found in ${files} files.`)];
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? '.');
  report(`Secrets: ${dir}`, scanSecrets(dir));
}
