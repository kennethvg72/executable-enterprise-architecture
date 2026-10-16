// Combines the probe results of every vantage point from one run window into one verdict (ZTN-06).
// Liveness comes from all of them: a target any vantage reached, or monitoring saw up, was up, so
// a timeout from elsewhere is evidence of filtering. Without that, most blocked probes have no
// positive control from their own vantage, and the gate could never pass.
//
// The verdict is still corroboration, not proof (probe.ts). PASS, FAIL or INCONCLUSIVE, with the
// same exit codes; only PASS lets a gate pass.
//
// Usage: node network/tools/probe-report.ts results-*.json [--alive monitoring-up.json] [--window-minutes 60]

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { EXIT_CODE, classify, reached, type Outcome } from './probe.ts';
import type { Probe } from './render.ts';

export interface VantageResults { from: string; started: string; finished: string; results: { probe: Probe; outcome: Outcome }[] }

export function combine(runs: VantageResults[], monitoring: string[] = [], windowMinutes = 60) {
  const times = runs.flatMap((r) => [Date.parse(r.started), Date.parse(r.finished)]);
  const spread = times.length ? (Math.max(...times) - Math.min(...times)) / 60_000 : 0;
  // Evidence from another time isn't evidence: the runs must come from one window.
  if (spread > windowMinutes || times.some(Number.isNaN)) {
    return { verdict: 'INCONCLUSIVE' as const, reason: `the vantages' runs span ${Math.round(spread)} minutes, more than the ${windowMinutes}-minute window`, wrong: [], inconclusive: [], refused: [] };
  }
  const evidence = new Set([...runs.flatMap((r) => [...reached(r.results)]), ...monitoring]);
  const all = runs.flatMap((r) => r.results);
  return { ...classify(all, evidence), reason: '' };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { alive: { type: 'string' }, 'window-minutes': { type: 'string', default: '60' } } });
  if (!positionals.length) {
    console.error('Usage: node network/tools/probe-report.ts results-*.json [--alive monitoring-up.json] [--window-minutes 60]');
    process.exit(2);
  }
  const runs = positionals.map((f) => JSON.parse(readFileSync(f, 'utf8')) as VantageResults);
  const monitoring = values.alive ? JSON.parse(readFileSync(values.alive, 'utf8')) as string[] : [];
  const r = combine(runs, monitoring, Number(values['window-minutes']));
  for (const { probe, outcome } of r.wrong) console.log(`FAIL ${probe.fromLabel} -> ${probe.toLabel} ${probe.to}:${probe.port}: expected ${probe.expect}, got ${outcome}`);
  for (const { probe } of r.inconclusive) console.log(`INCONCLUSIVE ${probe.fromLabel} -> ${probe.toLabel} ${probe.to}:${probe.port}: nothing in this window shows ${probe.to} was up`);
  console.log(`${runs.length} vantages, ${runs.reduce((n, x) => n + x.results.length, 0)} probes: ${r.verdict}${r.reason ? ` (${r.reason})` : ''}.`);
  process.exitCode = EXIT_CODE[r.verdict];
}
