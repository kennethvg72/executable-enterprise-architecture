// The authority for Patroni's dynamic settings (DEL-06): after the deployment process applies
// patroni/<cluster>.dcs.yml, the running cluster must report exactly those values (GET /config on
// the leader). A pipeline step after every apply in test, acceptance and production, and the daily
// drift check (DEL-04). Settings the cluster has beyond the file (kept by --apply) are reported,
// never silently accepted.
//
// Usage: node infrastructure/tools/check-patroni-config.ts --cluster app-db --url https://10.1.30.31:8008 [--ca <file>]

import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { REPO_ROOT } from '../../enterprise-architecture/tools/lib/load.ts';
import { fail, pass, report, tiered, warn, type Result } from '../../enterprise-architecture/tools/lib/report.ts';

/** GET <url>/config, with the workload CA for HTTPS. */
export function fetchConfig(url: string, ca?: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const target = new URL('/config', url);
    const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: 'GET', timeout: timeoutMs, ...(ca ? { ca: readFileSync(ca) } : {}) }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error(`GET /config answered ${res.statusCode}`)); return; }
        try { resolve(JSON.parse(body)); } catch { reject(new Error('GET /config did not return JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end();
  });
}

/** Every setting in the file must be in the running cluster with the same value; anything more is reported. */
export function compareConfig(cluster: string, applied: unknown, running: unknown): Result[] {
  const missing: string[] = [];
  const extra: string[] = [];
  const walk = (want: unknown, have: unknown, path: string) => {
    if (typeof want === 'object' && want !== null) {
      if (typeof have !== 'object' || have === null) { missing.push(`${path || 'the settings'} are missing`); return; }
      const w = want as Record<string, unknown>;
      const h = have as Record<string, unknown>;
      for (const k of Object.keys(w)) walk(w[k], h[k], path ? `${path}.${k}` : k);
      for (const k of Object.keys(h)) if (!(k in w)) extra.push(path ? `${path}.${k}` : k);
      return;
    }
    // Patroni reports some values as strings ("on"), some as numbers: compare their text.
    if (String(have) !== String(want)) missing.push(`${path} is ${JSON.stringify(have)}, not ${JSON.stringify(want)}`);
  };
  walk(applied, running, '');
  return tiered('authority', [
    missing.length
      ? fail('RES-05', `${cluster}: the running cluster differs from patroni/${cluster}.dcs.yml: ${missing.join('; ')}.`, 'Apply the file again (patronictl edit-config --apply), and find out what changed it.')
      : pass('RES-05', `${cluster}: the running cluster has exactly the applied settings.`),
    ...(extra.length ? [warn('RES-05', `${cluster}: settings the running cluster has beyond the file: ${extra.join(', ')}. Kept by --apply; each needs a reason.`)] : []),
  ]);
}

export async function checkPatroniConfig(cluster: string, url: string, ca?: string): Promise<Result[]> {
  const applied = parse(readFileSync(join(REPO_ROOT, 'infrastructure', 'generated', 'patroni', `${cluster}.dcs.yml`), 'utf8'));
  try {
    return compareConfig(cluster, applied, await fetchConfig(url, ca));
  } catch (e) {
    return tiered('authority', [fail('RES-05', `${cluster}: couldn't read the running configuration from ${url}: ${(e as Error).message}.`, 'Check that Patroni answers on its API, then run this again.')]);
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { cluster: { type: 'string' }, url: { type: 'string' }, ca: { type: 'string' } } });
  if (!values.cluster || !values.url) {
    console.error('Usage: node infrastructure/tools/check-patroni-config.ts --cluster <id> --url <https://node:8008> [--ca <file>]');
    process.exit(2);
  }
  report(`Patroni's running configuration: ${values.cluster}`, await checkPatroniConfig(values.cluster, values.url, values.ca));
}
