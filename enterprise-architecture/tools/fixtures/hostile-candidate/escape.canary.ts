// The hostile canary (SEC-13): a release candidate whose tests try to escape the pipeline's
// runner. Each test is one escape attempt, and passes only if the attempt fails. It records
// whether an attempt succeeded, never what it found: file and variable names, no contents.
//
// Run it with verify-runner.ts, inside the runner, never on its own. It is deliberately not
// named *.test.ts, so the repository's own tests never run it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WORKSPACE = resolve(import.meta.dirname);
const RUN = process.env.NATAX_CANARY_RUN ?? '1';
const MARKERS = [join(tmpdir(), 'natax-canary-marker'), join(homedir(), '.natax-canary-marker')];

/** Writes a file and removes it again; true if the write succeeded. */
function canWrite(file: string): boolean {
  try { writeFileSync(file, 'canary'); rmSync(file); return true; } catch { return false; }
}

function canRead(path: string): boolean {
  try { accessSync(path, constants.R_OK); if (existsSync(path)) readdirSync(path); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOTDIR'; }   // a readable file, not a directory
}

function reaches(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host, port });
    const end = (open: boolean) => { socket.destroy(); done(open); };
    socket.setTimeout(timeoutMs, () => end(false));
    socket.once('connect', () => end(true));
    socket.once('error', () => end(false));
  });
}

test('no credentials in the environment, except the run\'s own test database', () => {
  const found = Object.keys(process.env).filter((name) =>
    /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE_?KEY|AUTH|DATABASE_URL/i.test(name) && name !== 'TEST_DATABASE_URL');
  assert.deepEqual(found, [], `credential-like variables present: ${found.join(', ')}`);
});

test('no credential files are readable', () => {
  const home = homedir();
  const candidates = [
    join(home, '.ssh'), join(home, '.git-credentials'), join(home, '.npmrc'), join(home, '.netrc'),
    join(home, '.config', 'gh', 'hosts.yml'), join(home, '.aws', 'credentials'), join(home, '.azure'),
    join(home, '.kube', 'config'), join(home, '.docker', 'config.json'),
    '/var/run/secrets/kubernetes.io/serviceaccount/token', '/run/secrets',
  ];
  const readable = candidates.filter(canRead);
  assert.deepEqual(readable, [], `readable: ${readable.join(', ')}`);
});

test('nothing outside the workspace is writable', () => {
  const outside = [join(homedir(), '.natax-canary-write'), resolve(WORKSPACE, '..', '.natax-canary-write')];
  if (process.env.ARCHITECTURE) outside.push(join(process.env.ARCHITECTURE, '.natax-canary-write'));
  const written = outside.filter(canWrite);
  assert.deepEqual(written, [], `written: ${written.join(', ')}`);
});

// Runs: "1" plants markers and "2" looks for them (verify-runner, two runners in a row).
// "preflight" is the pipeline, before every candidate: it looks for markers left by any earlier
// run, then plants its own for the next one. In disposable runners, nothing is ever found.
test('nothing survives from one run to the next', () => {
  const plant = () => { for (const marker of MARKERS) try { writeFileSync(marker, 'canary'); } catch { /* not writable: fine */ } };
  if (RUN === '1') { plant(); return; }
  const survived = MARKERS.filter((m) => existsSync(m));
  if (RUN === '2') for (const m of survived) rmSync(m, { force: true });
  if (RUN === 'preflight') plant();
  assert.deepEqual(survived, [], `left by an earlier run: ${survived.join(', ')}`);
});

test('the internet is unreachable', async () => {
  assert.equal(await reaches('1.1.1.1', 443), false, 'reached 1.1.1.1:443');
});

test('production is unreachable', async () => {
  // The database endpoint on DC1's internal load balancer, from landscape.yaml.
  assert.equal(await reaches('10.1.50.10', 5432), false, 'reached the production database endpoint');
});
