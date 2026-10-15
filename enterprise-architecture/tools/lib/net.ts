// IPv4 helpers. Enough for an address plan; not a general-purpose library.

export function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`Not an IPv4 address: ${ip}`);
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

/** True if `address` (an IP or a CIDR) lies entirely within `cidr`. */
export function within(address: string, cidr: string): boolean {
  const [net, bitsText] = cidr.split('/');
  const bits = bitsText === undefined ? 32 : Number(bitsText);
  const [addr, addrBitsText] = address.split('/');
  const addrBits = addrBitsText === undefined ? 32 : Number(addrBitsText);
  if (addrBits < bits) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ipToInt(addr!) & mask) >>> 0) === ((ipToInt(net!) & mask) >>> 0);
}

/** NATAX's own address space. "The internet" (0.0.0.0/0) never includes it. */
export const NATAX_SPACE = '10.0.0.0/8';

/** True if `address` is one of a flow's peers: like within(), except that the internet excludes NATAX. */
export function isPeer(address: string, peer: string): boolean {
  return peer === '0.0.0.0/0' ? !within(address, NATAX_SPACE) : within(address, peer);
}

/** The site whose prefix contains the address, if any. */
export function siteOf(address: string, sites: Record<string, { prefix: string }>): string | undefined {
  return Object.entries(sites).find(([, s]) => within(address, s.prefix))?.[0];
}
