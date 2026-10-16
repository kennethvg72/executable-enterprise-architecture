// SEC-14: every change to the pipeline's own inputs carries two signatures from distinct workforce
// identities, one in the Architecture Board group and one in Central IT, with group membership
// resolved from the workforce IdP when this runs, never from a file. Or it is a break-glass
// change: one signer, a reason, at most 72 hours, flagged in every verdict it touches.
//
// Deliberately small, so a Board member can read all of it in a minute: this check is itself
// pipeline code that Central IT runs, and changes to it go through the Board's own instance.

import { type Result, fail, pass, skip, warn } from './lib/report.ts';

/** What the pipeline reads to decide. A change to any of these is a change to the gate. */
export const GATE_INPUTS = [
  'enterprise-architecture/governance/exceptions.yaml',
  'enterprise-architecture/governance/secret-scan-allowlist.yaml',
  'enterprise-architecture/governance/versions.yaml',
  'enterprise-architecture/landscape/landscape.yaml',
  'enterprise-architecture/landscape/workforce-directory.yaml',
  'enterprise-architecture/agents/',
  'enterprise-architecture/pipeline/models.yaml',
  'enterprise-architecture/tools/',
  'network/tools/', 'network/expectations.yaml', 'network/runtime-versions.yaml',
  'infrastructure/tools/', 'infrastructure/runtime-versions.yaml',
  'platforms/*/platform.yaml', 'platforms/*/approved-dependencies.yaml', 'platforms/*/approved-connectors.yaml', 'platforms/*/agents/',
];

export const isGateInput = (file: string) => GATE_INPUTS.some((g) => {
  const re = new RegExp(`^${g.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]+')}${g.endsWith('/') ? '' : '$'}`);
  return re.test(file);
});

export interface Change { commit: string; files: string[]; signers: string[]; breakGlass?: { reason: string; at: Date } }
/** The groups an identity is in, from the workforce IdP. */
export type GroupsOf = (identity: string) => string[];

const BREAK_GLASS_HOURS = 72;

export function judgeGateChanges(changes: Change[], groupsOf: GroupsOf | undefined, now: Date): Result[] {
  const relevant = changes.filter((c) => c.files.some(isGateInput));
  if (!relevant.length) return [pass('SEC-14', 'No change to the gate\'s inputs.')];
  if (!groupsOf) return [skip('SEC-14', `${relevant.length} changes to the gate's inputs, but the IdP can't be asked who signed them.`)];
  return relevant.map((c) => {
    const signers = [...new Set(c.signers)];
    const board = signers.filter((s) => groupsOf(s).includes('architecture-board'));
    const centralIt = signers.filter((s) => groupsOf(s).includes('central-it'));
    // Two people: one from each group, and not the same person counted twice.
    if (board.some((b) => centralIt.some((x) => x !== b))) return pass('SEC-14', `${c.commit}: signed by the Board and Central IT.`);
    if (c.breakGlass && signers.length >= 1) {
      const hours = (now.getTime() - c.breakGlass.at.getTime()) / 3_600_000;
      return hours <= BREAK_GLASS_HOURS
        ? warn('SEC-14', `${c.commit}: BREAK-GLASS by ${signers.join(', ')} (${c.breakGlass.reason}), ${Math.round(BREAK_GLASS_HOURS - hours)} hours left. Flagged in every verdict until the Board has reviewed it.`)
        : fail('SEC-14', `${c.commit}: a break-glass change older than ${BREAK_GLASS_HOURS} hours without the Board's signature.`, 'The Board reviews and signs it, or it is reverted.');
    }
    return fail('SEC-14', `${c.commit}: changes the gate's inputs (${c.files.filter(isGateInput).join(', ')}) without signatures from both the Board and Central IT.`, 'A second signature from the other group, or revert it.');
  });
}
