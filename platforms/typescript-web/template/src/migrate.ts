// Applies migrations/NNNN_name.sql in order, each once, each in its own transaction.
// An advisory lock makes concurrent runs (two instances starting at once) safe.
// Usage: node src/migrate.ts   (uses MIGRATION_DATABASE_URL: the owner role, never the runtime role)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');
const LOCK_ID = 7_340_001;

export async function migrate(databaseUrl: string, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const files = migrationFiles(dir);
    for (const file of files) {
      const version = file.slice(0, 4);
      if (done.has(version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    await client.end();
  }
  return applied;
}

if (import.meta.main) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL is required (the database owner role).');
    process.exit(2);
  }
  const applied = await migrate(url);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
}

/**
 * The migrations, in order. Each version (the four-digit prefix) is recorded once it has run, so
 * two files with the same prefix would leave the second unapplied forever, silently. Refused.
 */
export function migrationFiles(dir: string): string[] {
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const seen = new Map<string, string>();
  for (const f of files) {
    const version = f.slice(0, 4);
    const earlier = seen.get(version);
    if (earlier) throw new Error(`Migrations ${earlier} and ${f} share the version ${version}; renumber one.`);
    seen.set(version, f);
  }
  return files;
}
