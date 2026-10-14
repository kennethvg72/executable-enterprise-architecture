// Test helpers: a fresh test database, an application on a random port, and a client that
// signs in through the real (development) sign-in and keeps its cookie and CSRF token.

import pg from 'pg';
import { start } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';
import { createLogger } from '../src/log.ts';
import { migrate } from '../src/migrate.ts';

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  // A missing test database is a failure, not a reason to skip (TS-10).
  if (!url) throw new Error('TEST_DATABASE_URL is not set. Run the bootstrap procedure, or copy .env.example to .env.');
  return url;
}

/** Drop everything in the test database and apply all migrations. */
export async function resetDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  await migrate(testDatabaseUrl());
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({ NODE_ENV: 'test', HOST: '127.0.0.1', DATABASE_URL: testDatabaseUrl(), DEV_SIGN_IN: 'true', TIME_ZONE: 'America/Chicago' }),
    port: 0,
    metricsPort: 0,
    ...overrides,
  };
}

export interface TestApp {
  url: string;
  metricsUrl: string;
  pool: Pool;
  logs: string[];
  close(): Promise<void>;
  client(): TestClient;
}

export async function startTestApp(options: { config?: Partial<Config>; pool?: Pool } = {}): Promise<TestApp> {
  const config = testConfig(options.config);
  const logs: string[] = [];
  const pool = options.pool ?? createPool(config.databaseUrl, config.dbPoolMax, { log: createLogger('test', (l) => logs.push(l)) });
  const running = await start({ config, pool, log: createLogger('test', (l) => logs.push(l)) });
  const url = `http://127.0.0.1:${running.port}`;
  return {
    url,
    metricsUrl: `http://127.0.0.1:${running.metricsPort}/metrics`,
    pool,
    logs,
    async close() { await running.close(); if (!options.pool) await pool.end(); },
    client: () => new TestClient(url),
  };
}

/** An HTTP client with a cookie jar of one session, for tests. */
export class TestClient {
  base: string;
  cookie = '';
  csrf = '';
  constructor(base: string) { this.base = base; }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(this.base + path, {
      redirect: 'manual',
      ...init,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(init.headers as Record<string, string> | undefined) },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      if (pair!.startsWith('__Host-session=')) this.cookie = pair!.endsWith('=') ? '' : pair!;
    }
    return res;
  }

  get(path: string, headers: Record<string, string> = {}) { return this.request(path, { headers }); }

  /** POST a form, adding the CSRF token unless the test says otherwise. */
  post(path: string, fields: Record<string, string> = {}, { csrf = true } = {}) {
    const body = new URLSearchParams({ ...(csrf && this.csrf ? { csrf: this.csrf } : {}), ...fields });
    return this.request(path, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }

  /** Sign in through the development sign-in, then pick up the CSRF token from a page. */
  async signInAs(role: string, name = 'Test User', page = '/'): Promise<this> {
    await this.post('/sign-in', { name, role }, { csrf: false });
    const html = await (await this.get(page)).text();
    this.csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
    return this;
  }
}
