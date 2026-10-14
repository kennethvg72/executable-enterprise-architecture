// The site topology as two graphs:
// - the DATA graph: in-band (wan) links only, with transit through HQ only if HQ routes it.
//   Replication and application traffic use this graph.
// - the QUORUM graph: every link a voting member can use. With an in-band witness this is
//   the same as the data graph. With an out-of-band witness (internet, cellular, cloud), it
//   has extra edges that data traffic can't use, and that's exactly the problem.

import type { Landscape } from '../../enterprise-architecture/tools/lib/model.ts';

export type Edge = [string, string];

export interface Topology {
  sites: string[];
  data: Edge[];
  quorum: Edge[];
  /** Sites that forward traffic between other sites over the data graph. */
  transit: Set<string>;
}

export function topology(landscape: Landscape): Topology {
  const sites = Object.keys(landscape.sites);
  const internal = (l: { between: [string, string] }) => l.between.every((s) => sites.includes(s));
  const data = landscape.links.filter((l) => internal(l) && l.network === 'wan').map((l) => l.between);
  // Links to the witness site that aren't in-band still carry quorum traffic.
  const witnesses = sites.filter((s) => landscape.sites[s]!.kind === 'witness');
  const outOfBand = landscape.links.filter((l) => internal(l) && l.network !== 'wan' && l.between.some((s) => witnesses.includes(s))).map((l) => l.between);
  const transit = new Set(sites.filter((s) => landscape.sites[s]!.kind === 'datacenter' || landscape.sites[s]!.transit));
  return { sites, data, quorum: [...data, ...outOfBand], transit };
}

/**
 * Connected components among the sites that are up, using the given edges. A site that
 * doesn't forward transit can still be reached itself, but traffic can't pass through it.
 */
export function components(sites: string[], edges: Edge[], up: Set<string>, transit: Set<string>): string[][] {
  const live = sites.filter((s) => up.has(s));
  const adjacent = (a: string) => edges.filter((e) => e.includes(a)).map((e) => (e[0] === a ? e[1] : e[0])).filter((b) => up.has(b));
  const reach = (from: string) => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const s = queue.shift()!;
      if (s !== from && !transit.has(s)) continue; // reachable, but doesn't forward
      for (const n of adjacent(s)) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    return seen;
  };
  // Two sites are connected if each can reach the other.
  const groups: string[][] = [];
  const placed = new Set<string>();
  for (const s of live) {
    if (placed.has(s)) continue;
    const group = [...reach(s)].filter((t) => reach(t).has(s));
    group.forEach((t) => placed.add(t));
    groups.push(group.sort());
  }
  return groups;
}

export function connected(t: Topology, edges: Edge[], up: Set<string>, a: string, b: string): boolean {
  return components(t.sites, edges, up, t.transit).some((g) => g.includes(a) && g.includes(b));
}
