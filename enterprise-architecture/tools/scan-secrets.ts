// SEC-03: a secret scanner. A real pipeline uses a dedicated scanner with hundreds of patterns
// and entropy analysis; this one covers the common kinds and shows the principle.
// Usage: node enterprise-architecture/tools/scan-secrets.ts <dir>
//
// There is no way to silence it from inside the scanned repository: a comment that says
// "ignore this" would be a self-service exception. A false positive is added to the central
// allowlist (governance/secret-scan-allowlist.yaml) by its fingerprint, with a reason.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { REPO_ROOT, readYaml } from './lib/load.ts';
import { fail, pass, report, type Result } from './lib/report.ts';

const SKIP_DIRS = new Set(['node_modules', '.git']);
const MAX_FILE_BYTES = 1_000_000;

/** Values that are clearly not secrets: references, placeholders, local development defaults. */
const PLACEHOLDER = /^(?:\$|<|\{\{|%|process\.env|env\.|os\.environ|x+$|\*+$|changeme$|example|dummy|redacted|your[-_])/i;
const SECRET_NAME = String.raw`(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|credentials?)`;

/** Files where an unquoted value is a literal, not an expression. */
const CONFIG_FILE = /(^|[\\/])\.env[^\\/]*$|\.(?:ya?ml|properties|ini|conf|cfg|toml)$/i;

const PATTERNS: { name: string; regex: RegExp; value?: number; files?: RegExp }[] = [
  { name: 'private key', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'AWS access key', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { name: 'GitLab token', regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Slack token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe key', regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'SendGrid key', regex: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
  { name: 'npm token', regex: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'Azure storage key', regex: /AccountKey=[A-Za-z0-9+/]{40,}={0,2}/ },
  { name: 'Azure SAS token', regex: /[?&]sig=[A-Za-z0-9%+/]{30,}/ },
  { name: 'JSON Web Token', regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // A secret-looking name assigned a literal: quoted anywhere; unquoted only in configuration files.
  { name: 'secret assignment', regex: new RegExp(String.raw`\b[\w.-]*${SECRET_NAME}[\w.-]*["']?\s*[:=]\s*(["'])([^\s"']{8,})\1`, 'i'), value: 2 },
  { name: 'secret in a configuration file', regex: new RegExp(String.raw`^\s*(?:export\s+)?[\w.-]*${SECRET_NAME}[\w.-]*\s*[:=]\s*([^\s"'#]{8,})`, 'i'), value: 1, files: CONFIG_FILE },
  // Credentials in a URL, unless the host is local (development defaults are fine).
  { name: 'credentials in URL', regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:([^\s/@'"]+)@(?!localhost\b|127\.0\.0\.1\b|\[::1\])[^\s/'"]+/i, value: 1 },
];

interface Allowed { fingerprint: string; reason: string; 'approved-by': string }

const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function scanSecrets(dir: string, allowlist = join(REPO_ROOT, 'enterprise-architecture', 'governance', 'secret-scan-allowlist.yaml')): Result[] {
  const allowed = new Set((existsSync(allowlist) ? readYaml<{ allowed?: Allowed[] }>(allowlist).allowed ?? [] : []).map((a) => a.fingerprint));
  const findings: Result[] = [];
  let files = 0;
  const scan = (full: string) => {
    if (!existsSync(full) || statSync(full).size > MAX_FILE_BYTES) return;
    files++;
    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      for (const p of PATTERNS) {
        if (p.files && !p.files.test(full)) continue;
        const m = p.regex.exec(line);
        if (!m) continue;
        if (p.value !== undefined && PLACEHOLDER.test(m[p.value] ?? '')) continue;
        const print = fingerprint(m[0]);
        if (allowed.has(print)) continue;
        findings.push(fail('SEC-03', `Possible ${p.name} in ${relative(dir, full)}:${i + 1} (fingerprint ${print}).`,
          'Remove it, rotate the secret (treat it as compromised), and load it from the secret store at runtime. If it really isn\'t a secret, ask Central IT to add its fingerprint to the central allowlist.'));
        break;
      }
    });
  };
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else scan(full);
    }
  };
  // In a Git repository, what a release would contain is what Git tracks: a developer's own .env,
  // ignored and never committed, isn't a secret in the repository. Anywhere else, every file.
  const tracked = spawnSync('git', ['-C', dir, 'ls-files', '-z', '--cached'], { encoding: 'utf8' });
  if (tracked.status === 0) for (const f of tracked.stdout.split('\0').filter(Boolean)) scan(join(dir, f));
  else walk(dir);
  return findings.length ? findings : [pass('SEC-03', `No secrets found in ${files} files.`)];
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? '.');
  report(`Secrets: ${dir}`, scanSecrets(dir));
}
