// Reads generated nftables rulesets back, and answers "would these rules let this connection
// through?" (DEL-06). It doesn't use the policy the rules were compiled from: it only reads the
// text, so a bug in the renderer shows up as a difference between intent and output.
//
// It is a fast reader, not the authority. The authority loads the rules into real nftables in a
// network namespace and sends traffic (authority.ts). This reader may only fail early: when it
// finds nothing wrong, the result still needs the authority before it counts.
//
// Its grammar is an explicit allowlist: exactly the statements NATAX's renderer produces, with
// every address and port validated. Anything else is refused, including statements that are
// perfectly valid nftables ("ct state new accept", "tcp dport { 1-65535 }", "meta l4proto tcp"):
// a reader that skips what it doesn't model certifies open firewalls as closed.

import { within } from '../../enterprise-architecture/tools/lib/net.ts';

interface AddressMatch { negate: boolean; cidrs: string[] }

export type Protocol = 'tcp' | 'udp' | 'icmp' | 'vrrp';

export interface NftRule {
  saddr?: AddressMatch;
  daddr?: AddressMatch;
  protocol: Protocol;
  /** tcp and udp: the one destination port. */
  port?: number;
  /** icmp: the accepted types. */
  icmpTypes?: string[];
  verdict: 'accept';
  line: string;
}

export interface NftChain { hook: string; policy: 'accept' | 'drop'; rules: NftRule[] }

const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const ADDRESS = String.raw`${OCTET}\.${OCTET}\.${OCTET}\.${OCTET}(?:\/(?:3[0-2]|[12]?\d))?`;
const ADDRESSES = String.raw`(?:${ADDRESS}|\{ ${ADDRESS}(?:, ${ADDRESS})* \})`;
const MATCH = (field: 'saddr' | 'daddr') => String.raw`ip ${field} (!= )?(${ADDRESSES}) `;
const ICMP_TYPES = new Set(['echo-request', 'destination-unreachable', 'time-exceeded']);

/** Every statement the renderer may produce, as a full-line pattern. Nothing else is read. */
const STATEMENTS: { re: RegExp; read?: (m: RegExpExecArray, line: string) => NftRule }[] = [
  // State tracking and loopback: never accept a new connection from another host.
  { re: /^ct state established,related accept$/ },
  { re: /^ct state invalid drop$/ },
  { re: /^(?:iif|oif) lo accept$/ },
  { re: /^limit rate \d+\/second log prefix "natax-[a-z-]+ "$/ },
  // A TCP or UDP flow: optional source, optional destination, exactly one port.
  {
    re: new RegExp(String.raw`^(?:${MATCH('saddr')})?(?:${MATCH('daddr')})?(tcp|udp) dport ([1-9]\d{0,4}) accept$`),
    read: (m, line) => {
      const port = Number(m[6]);
      if (port > 65535) throw new Error(`Port out of range: ${line}`);
      return { ...addresses(m[1], m[2], m[3], m[4]), protocol: m[5] as 'tcp' | 'udp', port, verdict: 'accept', line };
    },
  },
  // ICMP, by type, optionally limited by source and destination.
  {
    re: new RegExp(String.raw`^(?:${MATCH('saddr')})?(?:${MATCH('daddr')})?ip protocol icmp icmp type (\{ [a-z-]+(?:, [a-z-]+)* \}|[a-z-]+) accept$`),
    read: (m, line) => {
      const types = m[5]!.replace(/[{}]/g, '').split(',').map((t) => t.trim());
      const unknown = types.filter((t) => !ICMP_TYPES.has(t));
      if (unknown.length) throw new Error(`ICMP type not in the grammar (${unknown.join(', ')}): ${line}`);
      return { ...addresses(m[1], m[2], m[3], m[4]), protocol: 'icmp', icmpTypes: types, verdict: 'accept', line };
    },
  },
  // VRRP between the two load balancers of a pair.
  {
    re: new RegExp(String.raw`^${MATCH('saddr').replace('saddr', '(saddr|daddr)')}ip protocol vrrp accept$`),
    read: (m, line) => ({ [m[1] as 'saddr' | 'daddr']: { negate: !!m[2], cidrs: list(m[3]!) }, protocol: 'vrrp', verdict: 'accept', line }),
  },
];

const list = (text: string) => text.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);

function addresses(sNeg?: string, s?: string, dNeg?: string, d?: string): Pick<NftRule, 'saddr' | 'daddr'> {
  return {
    ...(s ? { saddr: { negate: !!sNeg, cidrs: list(s) } } : {}),
    ...(d ? { daddr: { negate: !!dNeg, cidrs: list(d) } } : {}),
  };
}

/** The chains of one ruleset, by hook (input, output, forward). Throws on anything outside the grammar. */
export function parseRuleset(text: string): Map<string, NftChain> {
  const chains = new Map<string, NftChain>();
  let current: NftChain | undefined;
  let depth = 0;
  for (const raw of text.split('\n')) {
    // Comments: a whole-line comment, or the comment "..." the renderer puts at the end of a rule.
    const line = raw.trim().startsWith('#') ? '' : raw.replace(/\s+comment "[^"\\]*"\s*$/, '').replace(/\s+# [^"]*$/, '').trim();
    if (!line) continue;
    if (/^table inet [a-z-]+ \{$/.test(line)) { if (depth !== 0) throw new Error(`Nested table: ${raw.trim()}`); depth = 1; continue; }
    if (/^chain (?:input|output|forward) \{$/.test(line)) { if (depth !== 1) throw new Error(`Chain outside a table: ${raw.trim()}`); depth = 2; current = undefined; continue; }
    if (line === '}') { depth--; if (depth < 0) throw new Error('Unbalanced braces.'); if (depth < 2) current = undefined; continue; }
    const head = /^type filter hook (input|output|forward) priority filter; policy (accept|drop);$/.exec(line);
    if (head) {
      if (depth !== 2 || current) throw new Error(`Chain header out of place: ${raw.trim()}`);
      if (chains.has(head[1]!)) throw new Error(`Second ${head[1]} chain: rules in it would be evaluated too.`);
      current = { hook: head[1]!, policy: head[2] as 'accept' | 'drop', rules: [] };
      chains.set(current.hook, current);
      continue;
    }
    if (!current) throw new Error(`Statement outside a chain: ${raw.trim()}`);
    const statement = STATEMENTS.map((s) => ({ s, m: s.re.exec(line) })).find((x) => x.m);
    if (!statement) throw new Error(`Not in the reader's grammar, so not trusted: ${raw.trim()}`);
    if (statement.s.read) current.rules.push(statement.s.read(statement.m!, raw.trim()));
  }
  if (depth !== 0) throw new Error('Unbalanced braces.');
  return chains;
}

const matches = (m: AddressMatch | undefined, address: string) =>
  !m || m.cidrs.some((c) => within(address, c)) !== m.negate;

/** Does this chain let a new connection from src to dst on port through? */
export function chainAccepts(chain: NftChain, src: string, dst: string, port: number, protocol: 'tcp' | 'udp' = 'tcp'): boolean {
  for (const r of chain.rules) {
    if (r.protocol !== protocol || r.port !== port) continue;
    if (!matches(r.saddr, src) || !matches(r.daddr, dst)) continue;
    return true;
  }
  return chain.policy === 'accept';
}

/** The rulesets of every host, by address. A host without a ruleset (a zone, an appliance) filters nothing itself. */
export type HostRules = Map<string, Map<string, NftChain>>;

/** Would the generated rules let a new connection from src to dst on port through, on both ends? */
export function rulesAllow(hosts: HostRules, src: string, dst: string, port: number, protocol: 'tcp' | 'udp' = 'tcp'): boolean {
  const out = hosts.get(src)?.get('output');
  const inp = hosts.get(dst)?.get('input');
  return (!out || chainAccepts(out, src, dst, port, protocol)) && (!inp || chainAccepts(inp, src, dst, port, protocol));
}
