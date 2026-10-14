// The template's own tests. Applications keep them, and add their own next to them.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import pg from 'pg';
import { ROLE_GROUPS, rolesFromGroups } from '../src/roles.ts';
import { resetDatabase, startTestApp, testDatabaseUrl, type TestApp } from './helpers.ts';

describe('configuration (TS-06, TS-07)', () => {
  // Production reads the database credential from the secret store's mounted file.
  const secretFile = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'database-url');
  writeFileSync(secretFile, 'postgres://x@db.natax.internal/x');
  const base = { DATABASE_URL: 'postgres://x@localhost/x' };
  test('production requires the egress proxy for sign-in (INT-05)', () => {
    const prod = { ...base, DATABASE_URL: undefined, DATABASE_URL_FILE: secretFile, NODE_ENV: 'production', TLS_CERT_FILE: 'c', TLS_KEY_FILE: 'k', OIDC_ISSUER: 'https://idp.example', OIDC_CLIENT_ID: 'x', OIDC_REDIRECT_URI: 'https://x/cb' };
    assert.throws(() => loadConfig(prod), /OIDC_CLIENT_SECRET_FILE|HTTPS_PROXY/);
  });
  test('production refuses plain HTTP and the development sign-in', () => {
    const prod = { ...base, DATABASE_URL: undefined, DATABASE_URL_FILE: secretFile, NODE_ENV: 'production' };
    assert.throws(() => loadConfig({ ...prod, OIDC_ISSUER: 'https://idp.example' }), /TLS/);
    assert.throws(() => loadConfig({ ...prod, DEV_SIGN_IN: 'true', TLS_CERT_FILE: 'c', TLS_KEY_FILE: 'k' }), /DEV_SIGN_IN/);
  });
  test('production refuses a database credential in a plain environment variable (SEC-03)', () => {
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', TLS_CERT_FILE: 'c', TLS_KEY_FILE: 'k' }), /DATABASE_URL_FILE/);
  });
  test('the development sign-in is refused when not listening on localhost', () => {
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'development', DEV_SIGN_IN: 'true', HOST: '0.0.0.0' }), /localhost|Plain HTTP/);
  });
  test('an invalid time zone is refused', () => {
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'development', DEV_SIGN_IN: 'true', TIME_ZONE: 'Mars/Olympus' }), /TIME_ZONE/);
  });
  test('development on localhost works', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'development', DEV_SIGN_IN: 'true' });
    assert.equal(c.host, '127.0.0.1');
    assert.equal(c.devSignIn, true);
  });
});

describe('roles (IAM-04)', () => {
  test('roles come only from known IdP groups', () => {
    assert.deepEqual(rolesFromGroups(['unrelated', ROLE_GROUPS.user]), ['user']);
    assert.deepEqual(rolesFromGroups('not-a-list'), []);
  });
  test('roles match architecture.yaml', () => {
    const manifest = readFileSync(new URL('../architecture.yaml', import.meta.url), 'utf8');
    const groups = [...manifest.matchAll(/^\s+group:\s*(\S+)/gm)].map((m) => m[1]).sort();
    assert.deepEqual(groups, Object.values(ROLE_GROUPS).sort());
  });
});

describe('the running application', () => {
  let app: TestApp;
  before(async () => { await resetDatabase(); app = await startTestApp(); });
  after(async () => { await app.close(); });

  test('liveness never depends on anything', async () => {
    const res = await fetch(`${app.url}/health/live`);
    assert.equal(res.status, 200);
  });

  test('readiness checks the database', async () => {
    const res = await fetch(`${app.url}/health/ready`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ready: true, checks: { database: 'ok' } });
  });

  test('every response carries the security headers (TS-07)', async () => {
    const res = await fetch(`${app.url}/health/live`);
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('pages require sign-in', async () => {
    const res = await app.client().get('/');
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location') ?? '', /^\/sign-in/);
  });

  test('a signed-in user without a role is refused', async () => {
    const client = await app.client().signInAs('');
    assert.equal((await client.get('/')).status, 403);
  });

  test('the session cookie is HttpOnly, Secure and SameSite', async () => {
    const res = await app.client().post('/sign-in', { name: 'A', role: 'user' }, { csrf: false });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('__Host-session='));
    assert.match(cookie ?? '', /HttpOnly/);
    assert.match(cookie ?? '', /Secure/);
    assert.match(cookie ?? '', /SameSite=Lax/);
  });

  test('output is escaped', async () => {
    const client = await app.client().signInAs('user', '<script>alert(1)</script>');
    const body = await (await client.get('/')).text();
    assert.ok(!body.includes('<script>alert(1)</script>'));
    assert.ok(body.includes('&lt;script&gt;'));
  });

  test('sign-out needs the CSRF token, and ends the session', async () => {
    const client = await app.client().signInAs('user');
    assert.equal((await client.post('/sign-out', {}, { csrf: false })).status, 403);
    assert.equal((await client.post('/sign-out')).status, 303);
    assert.equal((await client.get('/')).status, 303);
  });

  test('the database stores only a hash of the session ID', async () => {
    const client = await app.client().signInAs('user');
    const raw = client.cookie.split('=')[1]!;
    const { rows } = await app.pool.query('SELECT id_hash FROM sessions');
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.id_hash !== raw && r.id_hash !== decodeURIComponent(raw)));
  });

  test('metrics are on their own port, in Prometheus format (OBS-02)', async () => {
    await fetch(`${app.url}/health/live`);
    const body = await (await fetch(app.metricsUrl)).text();
    assert.match(body, /# TYPE http_requests_total counter/);
    assert.match(body, /http_request_duration_seconds_bucket/);
    assert.equal((await fetch(`${app.url}/metrics`)).status, 404);
  });

  test('the request ID comes from traceparent, and appears in the logs (OBS-05)', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    await fetch(`${app.url}/health/live`, { headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` } });
    const entry = app.logs.map((l) => JSON.parse(l)).find((e) => e.requestId === traceId);
    assert.ok(entry, 'expected a log entry with the trace ID');
    assert.equal(entry.route, '/health/live');
    assert.equal(typeof entry.time, 'string');
  });

  test('logs contain no session IDs (OBS-01)', async () => {
    const client = await app.client().signInAs('user');
    const raw = decodeURIComponent(client.cookie.split('=')[1]!);
    await client.get('/');
    assert.ok(app.logs.every((l) => !l.includes(raw)));
  });

  test('beyond the concurrency limit, requests get a fast 503 with Retry-After (RES-08)', async () => {
    const busy = await startTestApp({ config: { maxConcurrentRequests: 0 } });
    const res = await fetch(`${busy.url}/sign-in`);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '2');
    // A busy instance is still healthy: readiness must not take every instance out under load.
    assert.equal((await fetch(`${busy.url}/health/ready`)).status, 200);
    await busy.close();
  });

  test('a malformed cookie from another application is ignored, not a 500', async () => {
    const res = await fetch(`${app.url}/sign-in`, { headers: { cookie: 'other=%ZZ; __Host-oidc=not-json' } });
    assert.equal(res.status, 200);
    assert.equal((await fetch(`${app.url}/rejections/%ZZ`)).status, 404);
  });

  test('sign-in only ever returns to this application (no open redirect)', async () => {
    for (const evil of ['//evil.example/', '/\evil.example', 'https://evil.example/', '/	/evil.example']) {
      const res = await app.client().post('/sign-in', { name: 'A', role: '', return: evil }, { csrf: false });
      const location = res.headers.get('location') ?? '';
      // Browsers resolve the Location against this site; it must stay on this site.
      assert.equal(new URL(location, 'https://app.example/').origin, 'https://app.example', `${evil} -> ${location}`);
    }
  });

  test('signing out ends at a signed-out page, not straight back at sign-in', async () => {
    const client = await app.client().signInAs('user');
    const res = await client.post('/sign-out');
    assert.equal(res.headers.get('location'), '/signed-out');
    assert.equal((await client.get('/signed-out')).status, 200);
  });

  test('FS-05: losing a database connection (failover) does not crash the process', async () => {
    const client = await app.client().signInAs('user');
    await client.get('/');                                    // the pool now has idle connections
    const admin = new pg.Client({ connectionString: testDatabaseUrl() });
    await admin.connect();
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state = 'idle'");
    await admin.end();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await client.get('/')).status, 200, 'the pool replaced the lost connections');
    assert.ok(app.logs.some((l) => l.includes('idle database connection lost')));
  });

  test('oversized form bodies are refused (TS-07)', async () => {
    const res = await app.client().request('/sign-in', {
      method: 'POST', body: 'name=' + 'x'.repeat(100_000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(res.status, 413);
  });
});

describe('readiness when the database is unreachable (RES-06, FS-02)', () => {
  test('readiness fails, liveness does not', async () => {
    const unreachable = new URL(testDatabaseUrl());
    unreachable.port = '1';
    const app = await startTestApp({ config: { databaseUrl: unreachable.href } });
    try {
      assert.equal((await fetch(`${app.url}/health/live`)).status, 200);
      const ready = await fetch(`${app.url}/health/ready`);
      assert.equal(ready.status, 503);
      const body = await ready.json() as { checks: Record<string, string> };
      assert.notEqual(body.checks.database, 'ok');
    } finally {
      await app.close();
    }
  });
});
