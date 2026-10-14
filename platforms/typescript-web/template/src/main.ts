// Entry point: configuration, logging, database, servers, graceful shutdown.

import { start } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { createLogger } from './log.ts';
import { createMetrics } from './metrics.ts';

const log = createLogger(process.env.npm_package_name ?? 'app');

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    log.error('invalid configuration', { reason: err.message });
    process.exit(78); // EX_CONFIG
  }
  throw err;
}

const metrics = createMetrics();
const pool = createPool(config.databaseUrl, config.dbPoolMax, { metrics, log });
const running = await start({ config, pool, log, metrics });

const shutdown = async (signal: string) => {
  log.info('shutting down', { signal });
  await running.close();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
