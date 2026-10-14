// Development only: create the development and test databases and the runtime role if they
// don't exist, and migrate the development database. The test database is reset by the tests.
// MIGRATION_DATABASE_URL and TEST_DATABASE_URL use the owner role; DATABASE_URL is the runtime
// role the application runs as (SEC-09).
// Usage: npm run db:setup

import pg from 'pg';
import { migrate } from '../src/migrate.ts';

async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected database name "${name}".`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.href });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!exists.rowCount) {
      await client.query(`CREATE DATABASE ${name}`);
      console.log(`Created database ${name}.`);
    }
  } finally {
    await client.end();
  }
}

/** The runtime role, with a development-only password. In production, Central IT provisions it. */
async function ensureRuntimeRole(ownerUrl: string, runtime: URL): Promise<void> {
  const role = decodeURIComponent(runtime.username);
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Unexpected role name "${role}".`);
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    if (!exists.rowCount) {
      await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${client.escapeLiteral(decodeURIComponent(runtime.password))}`);
      console.log(`Created role ${role}.`);
    }
  } finally {
    await client.end();
  }
}

if (process.env.NODE_ENV !== 'development') {
  console.error('db:setup is for development only (NODE_ENV=development).');
  process.exit(2);
}
for (const v of ['MIGRATION_DATABASE_URL', 'TEST_DATABASE_URL', 'DATABASE_URL']) {
  if (!process.env[v]) { console.error(`${v} is required.`); process.exit(2); }
}
await ensureDatabase(process.env.MIGRATION_DATABASE_URL!);
await ensureDatabase(process.env.TEST_DATABASE_URL!);
await ensureRuntimeRole(process.env.MIGRATION_DATABASE_URL!, new URL(process.env.DATABASE_URL!));
const applied = await migrate(process.env.MIGRATION_DATABASE_URL!);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Development database is up to date.');
