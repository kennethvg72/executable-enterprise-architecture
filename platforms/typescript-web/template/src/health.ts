// Liveness and readiness (RES-06). Liveness never checks dependencies. Readiness checks only
// the critical ones, with a short timeout, and caches the result for at most 5 seconds.

export interface Check {
  name: string;
  run: () => Promise<void>;
}

export interface Readiness {
  ready: boolean;
  checks: Record<string, 'ok' | string>;
}

const CHECK_TIMEOUT_MS = 1000;
const CACHE_MS = 5000;

function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return Promise.race([p, new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms).unref())]);
}

export function createHealth(critical: Check[], now: () => number = Date.now) {
  let cached: { at: number; result: Readiness } | undefined;
  // Concurrent calls share one check in flight. Without this, a burst of readiness calls with an
  // expired cache would each open a database connection: the health check becomes the overload.
  let inFlight: Promise<Readiness> | undefined;
  const check = async (): Promise<Readiness> => {
    const checks: Readiness['checks'] = {};
    await Promise.all(critical.map(async (c) => {
      try {
        await withTimeout(c.run(), CHECK_TIMEOUT_MS);
        checks[c.name] = 'ok';
      } catch (err) {
        checks[c.name] = err instanceof Error ? err.message : 'failed';
      }
    }));
    const result = { ready: Object.values(checks).every((v) => v === 'ok'), checks };
    cached = { at: now(), result };
    return result;
  };
  return {
    live: (): { live: true } => ({ live: true }),
    ready(): Promise<Readiness> {
      if (cached && now() - cached.at < CACHE_MS) return Promise.resolve(cached.result);
      inFlight ??= check().finally(() => { inFlight = undefined; });
      return inFlight;
    },
  };
}
