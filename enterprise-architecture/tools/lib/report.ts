// A check result, and a uniform way to print results and set the exit code.

export type Status = 'pass' | 'fail' | 'warn' | 'skip';

export interface Result {
  rule: string;       // rule ID, e.g. OWN-01, or a check name
  status: Status;
  message: string;
  fix?: string;       // the compliant path forward, for failures
}

export const pass = (rule: string, message: string): Result => ({ rule, status: 'pass', message });
export const warn = (rule: string, message: string, fix?: string): Result => ({ rule, status: 'warn', message, ...(fix ? { fix } : {}) });
export const fail = (rule: string, message: string, fix?: string): Result => ({ rule, status: 'fail', message, ...(fix ? { fix } : {}) });
/** A check that did not run. Never reported as passed. */
export const skip = (rule: string, message: string): Result => ({ rule, status: 'skip', message });

const ICON: Record<Status, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIPPED' };

export function format(title: string, results: Result[], { verbose = false } = {}): string {
  const lines = [`## ${title}`, ''];
  const shown = verbose ? results : results.filter((r) => r.status !== 'pass');
  for (const r of shown) {
    lines.push(`- ${ICON[r.status]} ${r.rule}: ${r.message}`);
    if (r.fix) lines.push(`  Path forward: ${r.fix}`);
  }
  const count = (s: Status) => results.filter((r) => r.status === s).length;
  lines.push('', `${count('pass')} passed, ${count('warn')} warnings, ${count('fail')} failed${count('skip') ? `, ${count('skip')} skipped` : ''}.`, '');
  return lines.join('\n');
}

export const failed = (results: Result[]) => results.some((r) => r.status === 'fail');

/** Print results and exit non-zero if anything failed. For command-line entry points. */
export function report(title: string, results: Result[]): void {
  const verbose = process.argv.includes('--verbose');
  console.log(format(title, results, { verbose }));
  if (failed(results)) process.exitCode = 1;
}
