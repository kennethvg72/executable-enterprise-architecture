// A check result, and a uniform way to print results and set the exit code.
//
// Exit codes, everywhere: 0 when everything ran and passed, 1 when something failed, 3 when
// nothing failed but something that had to run didn't (INCOMPLETE). Only 0 lets a gate pass.

export type Status = 'pass' | 'fail' | 'warn' | 'skip';

/**
 * Who produced a result, when that matters (DEL-06). A "reader" reads generated configuration
 * as text: fast, and allowed to fail early, but its pass is never proof. The "authority" runs the
 * real software (nftables, HAProxy, Patroni) and observes what it does.
 */
export type Tier = 'reader' | 'authority';

export interface Result {
  rule: string;       // rule ID, e.g. OWN-01, or a check name
  status: Status;
  message: string;
  fix?: string;       // the compliant path forward, for failures
  tier?: Tier;
}

export const pass = (rule: string, message: string): Result => ({ rule, status: 'pass', message });
export const warn = (rule: string, message: string, fix?: string): Result => ({ rule, status: 'warn', message, ...(fix ? { fix } : {}) });
export const fail = (rule: string, message: string, fix?: string): Result => ({ rule, status: 'fail', message, ...(fix ? { fix } : {}) });
/** A check that did not run. Never reported as passed. */
export const skip = (rule: string, message: string): Result => ({ rule, status: 'skip', message });
/** The same results, labeled with the tier that produced them. */
export const tiered = (tier: Tier, results: Result[]): Result[] => results.map((r) => ({ ...r, tier }));

const ICON: Record<Status, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIPPED' };

export function format(title: string, results: Result[], { verbose = false } = {}): string {
  const lines = [`## ${title}`, ''];
  const shown = verbose ? results : results.filter((r) => r.status !== 'pass');
  for (const r of shown) {
    lines.push(`- ${ICON[r.status]} ${r.rule}${r.tier ? ` [${r.tier}]` : ''}: ${r.message}`);
    if (r.fix) lines.push(`  Path forward: ${r.fix}`);
  }
  const count = (s: Status) => results.filter((r) => r.status === s).length;
  lines.push('', `${count('pass')} passed, ${count('warn')} warnings, ${count('fail')} failed${count('skip') ? `, ${count('skip')} skipped` : ''}.`, '');
  return lines.join('\n');
}

export const failed = (results: Result[]) => results.some((r) => r.status === 'fail');
export const incomplete = (results: Result[]) => !failed(results) && results.some((r) => r.status === 'skip');

/** Print results and set the exit code: 1 if anything failed, 3 if something didn't run. */
export function report(title: string, results: Result[]): void {
  const verbose = process.argv.includes('--verbose');
  console.log(format(title, results, { verbose }));
  if (failed(results)) process.exitCode = 1;
  else if (incomplete(results)) {
    console.log('INCOMPLETE: nothing failed, but not everything ran. That is not a pass.');
    process.exitCode = 3;
  }
}
