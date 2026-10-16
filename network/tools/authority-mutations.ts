// The network authority's own tests (DEL-06): real nftables must catch what the earlier text reader
// certified as safe. Linux and root only, so not part of `npm test`; run with `npm run test:authority`
// in the pipeline's runner, or in WSL as root.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModel } from '../../enterprise-architecture/tools/lib/load.ts';
import { networkAuthority } from './authority.ts';
import { renderAll } from './compile.ts';
import { compilePolicy } from './policy.ts';

const model = loadModel();
const policy = compilePolicy(model);
const rendered = renderAll(model, policy);
const verdict = (files: Map<string, string>, only: string[]) => {
  const r = networkAuthority(model, policy, files, only)[0]!;
  assert.notEqual(r.status, 'skip', `the authority didn't run: ${r.message}`);
  return r.status;
};
const mutate = (file: string, change: (t: string) => string) => {
  const files = new Map(rendered);
  const before = files.get(file)!;
  files.set(file, change(before));
  assert.notEqual(files.get(file), before, 'the mutation did not apply');
  return files;
};
const insert = (rule: string) => (t: string) => t.replace('    limit rate 10/second log prefix "natax-drop-in "', `    ${rule}\n    limit rate 10/second log prefix "natax-drop-in "`);

test('the generated rules, unchanged, are proven in the kernel', () => {
  assert.equal(verdict(rendered, ['app-db', 'rejection-triage', 'hq-router']), 'pass');
});

// Round 2's differentials: valid nftables that the earlier reader certified as closed, while the
// kernel accepted the traffic. The authority must see what the kernel does.
for (const [name, file, change, only] of [
  ['every new connection accepted', 'nftables/app-db.nft', insert('ct state new accept'), ['app-db']],
  ['a port range', 'nftables/app-db.nft', insert('ip saddr 10.0.0.0/8 tcp dport { 1-65535 } accept'), ['app-db']],
  ['a named port', 'nftables/app-db.nft', insert('ip saddr 10.0.0.0/8 tcp dport { postgresql } accept'), ['app-db']],
  ['a declared path dropped', 'nftables/rejection-triage.nft', (t: string) => t.replace(/[^\n]*"Stores triage state\."\n/, ''), ['rejection-triage']],
  ['app-db replication can\'t transit HQ', 'nftables/hq-router.nft', (t: string) => t.replace(/[^\n]*ip saddr 10\.1\.30\.31 ip daddr 10\.2\.30\.31 tcp dport 5432 accept[^\n]*\n/, ''), ['hq-router']],
  ['name resolution blocked', 'nftables/rejection-triage.nft', (t: string) => t.replace(/[^\n]*udp dport 53 accept[^\n]*\n/, ''), ['rejection-triage']],
] as [string, string, (t: string) => string, string[]][]) {
  test(`the kernel catches: ${name}`, () => {
    assert.equal(verdict(mutate(file, change), only), 'fail');
  });
}
