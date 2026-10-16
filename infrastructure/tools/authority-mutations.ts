// The load balancer authority's own tests (DEL-06): real HAProxy must show what the text readers
// were fooled by. Linux and root only, so not part of `npm test`; run with `npm run test:authority`
// in the pipeline's runner, or in WSL as root.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModel } from '../../enterprise-architecture/tools/lib/load.ts';
import { infrastructureAuthority } from './authority.ts';
import { renderAll } from './render.ts';

const model = loadModel();
const rendered = renderAll(model);
const FILE = 'haproxy/platform-lb-dc1.cfg';
const verdict = (files: Map<string, string>) => {
  const r = infrastructureAuthority(model, files, 'dc1')[0]!;
  assert.notEqual(r.status, 'skip', `the authority didn't run: ${r.message}`);
  return r;
};
const mutate = (change: (t: string) => string) => {
  const files = new Map(rendered);
  const before = files.get(FILE)!;
  files.set(FILE, change(before));
  assert.notEqual(files.get(FILE), before, 'the mutation did not apply');
  return files;
};

test('the generated configuration, unchanged, behaves as intended in real HAProxy', () => {
  const r = verdict(rendered);
  assert.equal(r.status, 'pass', r.message);
});

for (const [name, change, symptom] of [
  ['certificates not verified', (t: string) => t.replaceAll('ssl verify required', 'ssl verify none'), /wrong certificate is marked DOWN/],
  ['clients can call /health/*', (t: string) => t.replace(/ {2}http-request deny deny_status 404[^\n]*\n/, ''), /can't call \/health/],
  ['the other datacenter active, not a backup', (t: string) => t.replace(/( server dc2-1 [^\n]*maxconn 200) backup/, '$1'), /own instances serve/],
  ['health checks switched off', (t: string) => t.replace(/ {2}option httpchk\n {2}http-check send meth GET uri \/health\/ready[^\n]*\n {2}http-check expect status 200\n/, ''), /other datacenter serves|wrong certificate/],
  ['a demoted primary keeps its connections, on app-db', (t: string) => t.replace(/(listen app-db[\s\S]*?) on-marked-down shutdown-sessions/, '$1'), /app-db: connections go to the primary/],
  ['a demoted primary keeps its connections, on core-db', (t: string) => t.replace(/(listen core-db[\s\S]*?) on-marked-down shutdown-sessions/, '$1'), /core-db: connections go to the primary/],
  ['sources that consume nothing may name anything', (t: string) => t.replace(/ {2}http-request deny deny_status 403 if !\{ src [^\n]*\n/, ''), /consumes nothing here/],
] as [string, (t: string) => string, RegExp][]) {
  test(`real HAProxy shows: ${name}`, () => {
    const r = verdict(mutate(change));
    assert.equal(r.status, 'fail', `not caught: ${r.message}`);
    assert.match(r.message, symptom);
  });
}
