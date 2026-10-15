// Reads generated nftables rulesets back, and answers "would these rules let this TCP connection
// through?" (DEL-06). It doesn't use the policy the rules were compiled from: it only reads the
// text, so a bug in the renderer shows up as a difference between intent and output.
//
// It understands exactly the statements NATAX's rulesets use, and refuses anything else. A
// ruleset it can't fully read is never assumed to be correct.

import { within } from '../../enterprise-architecture/tools/lib/net.ts';

interface AddressMatch { negate: boolean; cidrs: string[] }

export interface NftRule {
  saddr?: AddressMatch;
  daddr?: AddressMatch;
  ports?: number[];
  /** tcp: the rule matches TCP (with or without a port); other: ICMP, VRRP and the like; any: every protocol. */
  protocol: 'tcp' | 'other' | 'any';
  verdict: 'accept' | 'drop';
  line: string;
}

export interface NftChain { hook: string; policy: 'accept' | 'drop'; rules: NftRule[] }

/** The chains of one ruleset, by hook (input, output, forward). Throws on anything it doesn't understand. */
export function parseRuleset(text: string): Map<string, NftChain> {
  const chains = new Map<string, NftChain>();
  let current: NftChain | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/comment "[^"]*"/, '').replace(/#.*$/, '').trim();
    if (!line || line === '}' || /^table inet [\w-]+ \{$/.test(line) || /^chain \w+ \{$/.test(line)) continue;
    const head = /^type filter hook (\w+) priority filter; policy (accept|drop);$/.exec(line);
    if (head) { current = { hook: head[1]!, policy: head[2] as 'accept' | 'drop', rules: [] }; chains.set(current.hook, current); continue; }
    if (!current) throw new Error(`Statement outside a chain: ${raw.trim()}`);
    // Statements that never accept a new TCP connection: state tracking, loopback, logging.
    if (/^ct state [\w,]+ (accept|drop)$/.test(line) || /^(iif|oif) lo accept$/.test(line) || /^limit rate \d+\/\w+ log prefix "[^"]*"$/.test(line)) continue;
    current.rules.push(parseRule(line, raw.trim()));
  }
  return chains;
}

function parseRule(line: string, original: string): NftRule {
  const rule: NftRule = { protocol: 'any', verdict: 'accept', line: original };
  let rest = line;
  const take = (re: RegExp) => { const m = re.exec(rest); if (m) rest = rest.slice(m[0].length).trim(); return m; };
  const set = (text: string) => text.startsWith('{') ? text.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : [text];
  for (;;) {
    let m;
    if ((m = take(/^ip (saddr|daddr) (!= )?(\{[^}]*\}|[\d./]+)/))) {
      rule[m[1] as 'saddr' | 'daddr'] = { negate: !!m[2], cidrs: set(m[3]!) };
    } else if ((m = take(/^tcp dport (\{[^}]*\}|\d+)/))) {
      rule.protocol = 'tcp';
      rule.ports = set(m[1]!).map(Number);
    } else if ((m = take(/^ip protocol (\w+)( icmp type \{[^}]*\})?/))) {
      rule.protocol = m[1] === 'tcp' ? 'tcp' : 'other';
    } else if ((m = take(/^(accept|drop)$/))) {
      rule.verdict = m[1] as 'accept' | 'drop';
      return rule;
    } else {
      throw new Error(`Unrecognized nftables statement: ${original}`);
    }
  }
}

const matches = (m: AddressMatch | undefined, address: string) =>
  !m || m.cidrs.some((c) => within(address, c)) !== m.negate;

/** Does this chain let a new TCP connection from src to dst on port through? */
export function chainAccepts(chain: NftChain, src: string, dst: string, port: number): boolean {
  for (const r of chain.rules) {
    if (r.protocol === 'other') continue;
    if (r.ports && !r.ports.includes(port)) continue;
    if (!matches(r.saddr, src) || !matches(r.daddr, dst)) continue;
    return r.verdict === 'accept';
  }
  return chain.policy === 'accept';
}

/** The rulesets of every host, by address. A host without a ruleset (a zone, an appliance) filters nothing itself. */
export type HostRules = Map<string, Map<string, NftChain>>;

/** Would the generated rules let a new TCP connection from src to dst on port through, on both ends? */
export function rulesAllow(hosts: HostRules, src: string, dst: string, port: number): boolean {
  const out = hosts.get(src)?.get('output');
  const inp = hosts.get(dst)?.get('input');
  return (!out || chainAccepts(out, src, dst, port)) && (!inp || chainAccepts(inp, src, dst, port));
}
