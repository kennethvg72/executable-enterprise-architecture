// Configuration from the environment, validated once at startup (TS-06).
// Unsafe development conveniences are refused outside development on localhost.

import { readFileSync } from 'node:fs';

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  metricsPort: number;
  databaseUrl: string;
  dbPoolMax: number;
  /** HTTPS with the workload certificate. Required in production (TS-07). */
  tls?: { cert: string; key: string; ca?: string };
  /** The development sign-in. Only in development, only on localhost. */
  devSignIn: boolean;
  oidc?: { issuer: string; clientId: string; clientSecret: string; redirectUri: string };
  timeZone: string;
  maxConcurrentRequests: number;
}

export class ConfigError extends Error {}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function int(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${name} must be a non-negative integer, got "${value}".`);
  return n;
}

/** Read a secret from the file the secret store mounted (SEC-03). */
function secretFile(name: string, path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    throw new ConfigError(`${name} points to ${path}, which can't be read.`);
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mode = env.NODE_ENV ?? 'production';
  if (mode !== 'development' && mode !== 'test' && mode !== 'production') {
    throw new ConfigError(`NODE_ENV must be development, test or production, got "${mode}".`);
  }
  const host = env.HOST ?? (mode === 'production' ? '0.0.0.0' : '127.0.0.1');
  const local = LOCAL_HOSTS.has(host);

  // In production the credential comes from the secret store's mounted file only (SEC-03).
  if (mode === 'production' && env.DATABASE_URL) throw new ConfigError('In production, use DATABASE_URL_FILE (the mounted secret), not DATABASE_URL.');
  const databaseUrl = env.DATABASE_URL ?? secretFile('DATABASE_URL_FILE', env.DATABASE_URL_FILE);
  if (!databaseUrl) throw new ConfigError('DATABASE_URL or DATABASE_URL_FILE is required.');

  const tls = env.TLS_CERT_FILE && env.TLS_KEY_FILE
    ? { cert: env.TLS_CERT_FILE, key: env.TLS_KEY_FILE, ...(env.TLS_CA_FILE ? { ca: env.TLS_CA_FILE } : {}) }
    : undefined;
  if (mode === 'production' && !tls) throw new ConfigError('Production requires TLS_CERT_FILE and TLS_KEY_FILE (TS-07).');
  if (!tls && !local) throw new ConfigError(`Plain HTTP is only allowed on localhost, not on ${host} (TS-07).`);

  const devSignIn = env.DEV_SIGN_IN === 'true';
  if (devSignIn && !(mode === 'development' || mode === 'test')) throw new ConfigError('DEV_SIGN_IN is refused outside development (TS-06).');
  if (devSignIn && !local) throw new ConfigError('DEV_SIGN_IN is refused unless the server listens on localhost (TS-06).');

  const oidc = env.OIDC_ISSUER
    ? {
        issuer: env.OIDC_ISSUER,
        clientId: env.OIDC_CLIENT_ID ?? '',
        clientSecret: secretFile('OIDC_CLIENT_SECRET_FILE', env.OIDC_CLIENT_SECRET_FILE) ?? '',
        redirectUri: env.OIDC_REDIRECT_URI ?? '',
      }
    : undefined;
  if (oidc && (!oidc.clientId || !oidc.clientSecret || !oidc.redirectUri)) {
    throw new ConfigError('OIDC_ISSUER needs OIDC_CLIENT_ID, OIDC_CLIENT_SECRET_FILE and OIDC_REDIRECT_URI.');
  }
  if (mode === 'production' && !oidc) throw new ConfigError('Production requires OIDC sign-in (IAM-02).');
  // Sign-in talks to the workforce IdP, which is outside NATAX: only through the egress proxy
  // (INT-05). Node's fetch uses HTTPS_PROXY only when NODE_USE_ENV_PROXY=1.
  if (mode === 'production' && (!env.HTTPS_PROXY || env.NODE_USE_ENV_PROXY !== '1')) {
    throw new ConfigError('Production requires HTTPS_PROXY (the egress proxy), NO_PROXY for internal hosts, and NODE_USE_ENV_PROXY=1.');
  }
  if (!oidc && !devSignIn) throw new ConfigError('No sign-in configured: set OIDC_ISSUER, or DEV_SIGN_IN=true in development.');

  const timeZone = env.TIME_ZONE ?? 'America/Chicago';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw new ConfigError(`TIME_ZONE "${timeZone}" is not a valid IANA time zone (TS-11).`);
  }

  return {
    env: mode,
    host,
    port: int('PORT', env.PORT, 8443),
    metricsPort: int('METRICS_PORT', env.METRICS_PORT, 9464),
    databaseUrl,
    dbPoolMax: int('DB_POOL_MAX', env.DB_POOL_MAX, 10),
    ...(tls ? { tls } : {}),
    devSignIn,
    ...(oidc ? { oidc } : {}),
    timeZone,
    maxConcurrentRequests: int('MAX_CONCURRENT_REQUESTS', env.MAX_CONCURRENT_REQUESTS, 200),
  };
}
