// PostgreSQL access through a bounded pool (TS-04, TS-09). Plain, parameterized SQL only.

import pg from 'pg';
import type { Logger } from './log.ts';
import type { Metrics } from './metrics.ts';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function createPool(databaseUrl: string, max: number, options: { metrics?: Metrics | undefined; log?: Logger | undefined } = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    connectionTimeoutMillis: 2000,   // waiting longer than this for a connection fails fast (RES-08)
    idleTimeoutMillis: 30_000,
    options: '-c statement_timeout=5000 -c lock_timeout=2000',
    application_name: process.env.npm_package_name ?? 'app',
  });
  // An idle connection dies when the database fails over or switches over (FS-05, FS-06).
  // Without this handler, that error would crash the process. The pool replaces the connection.
  pool.on('error', (err) => options.log?.warn('idle database connection lost', { reason: err.message }));
  if (options.metrics) {
    const m = options.metrics;
    m.gauge('db_pool_connections', 'Open database connections.', () => pool.totalCount);
    m.gauge('db_pool_idle', 'Idle database connections.', () => pool.idleCount);
    m.gauge('db_pool_waiting', 'Requests waiting for a database connection (saturation).', () => pool.waitingCount);
  }
  return pool;
}

/** Run `work` in a transaction; roll back on any error. */
export async function transaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Readiness asks "can this instance reach its database?" on a connection of its own, so a busy
 * pool (which is overload, handled by fast 503s) isn't mistaken for an unreachable database
 * (RES-06). One per instance, kept open and reused: a burst of readiness checks never opens
 * connections the database may not have (INF-05).
 */
export function createDatabaseCheck(databaseUrl: string, timeoutMs = 1000): { run: () => Promise<void>; close: () => Promise<void> } {
  let client: pg.Client | undefined;
  const close = async () => { const c = client; client = undefined; await c?.end().catch(() => {}); };
  const run = async () => {
    try {
      if (!client) {
        const c = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs });
        c.on('error', () => { if (client === c) client = undefined; c.end().catch(() => {}); });
        await c.connect();
        client = c;
      }
      await client.query('SELECT 1');
    } catch (err) {
      const c = client;
      client = undefined;
      await c?.end().catch(() => {});
      throw err;
    }
  };
  return { run, close };
}

