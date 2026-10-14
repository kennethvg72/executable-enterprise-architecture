# Sites

NATAX runs on three sites, connected by one routed network.

```
                     HQ (witness)
                    10.3.0.0/16
                   ╱            ╲
         WAN 10 Gb/s            WAN 10 Gb/s
                 ╱                ╲
     DC1 ──────────── WAN 100 Gb/s ──────────── DC2
  10.1.0.0/16       (direct dark fiber)      10.2.0.0/16
      │                                          │
   internet                                   internet
```

## DC1 and DC2

Two datacenters, about 40 km apart. Synchronous replication between them adds about half a millisecond of round trip to every database commit, plus the replica's write-ahead log flush. Both run production all the time ([RES-02](../principles/resilience.md#res-02-dc1-and-dc2-are-both-production-all-the-time)). Each has its own internet connection, its own edge load balancers, and its own instances of every class A and B service. The edge load balancers also provide the DNS-based global load balancing that spreads users across both datacenters.

Each datacenter can run all class A and B production services at the planning peak on its own ([RES-03](../principles/resilience.md#res-03-one-datacenter-carries-the-whole-peak)). Production in both datacenters is always deployed at that size. In normal operation, production uses roughly half of what it reserves, and test and acceptance environments run at lower priority on the rest. When a datacenter is lost, production in the surviving one gets busy, and test and acceptance slow down or are suspended.

| | DC1 | DC2 |
|---|---|---|
| vCPU (total) | 1,800 | 1,800 |
| Reserved by class A and B production at the planning peak | 1,056 | 1,056 |
| Class C (data warehouse, DC1 only) | 64 | — |
| Typically used by test and acceptance | about 750 | about 750 |

The numbers come from [landscape.yaml](landscape.yaml), and `infrastructure/tools/verify.ts` checks them on every change.

Storage isn't replicated between the datacenters. PostgreSQL replication is the only cross-site replication of data; adding a second mechanism underneath it would add cost and failure modes without adding protection.

## HQ

The headquarters office building. Its server room holds **minimal compute**: a small cluster that runs the third voting member of every quorum NATAX operates (etcd for the PostgreSQL clusters). It runs no production workloads and holds no customer data. It does hold production quorum state, so it is protected like production: same access controls, same patching, no administrative access except from PAWs.

### Why HQ is in-band

HQ is connected to DC1 and DC2 by the same routed WAN that connects the two datacenters, and **routes traffic between them**. If the direct DC1–DC2 fiber is cut, DC1 and DC2 still reach each other through HQ, at reduced bandwidth.

This is deliberate ([RES-04](../principles/resilience.md#res-04-three-voting-sites-and-the-witness-is-in-band)). If the witness were reachable over a separate path, such as an internet VPN or a cloud-hosted witness, cutting the DC1–DC2 fiber would leave **both datacenters able to see the witness but not each other**. Every quorum member would still have a majority, so nothing would fail over. Meanwhile, the synchronous replica would stop receiving changes, and applications in one datacenter couldn't reach the database primary in the other. Every component would report itself healthy while the system as a whole was broken.

Because HQ is in-band, reachability is transitive. A clean partition can isolate at most one site, and an isolated site loses quorum. Partial failures are still possible, for example a firewall rule that drops replication but not quorum traffic. That is why the network policy is verified on every change and the fiber cut is rehearsed.

Three consequences that are easy to miss:

- **The 10 Gb/s HQ links carry all DC1↔DC2 traffic when the fiber is down**: quorum (highest priority), replication, and application traffic to database primaries in the other datacenter. Backup copies between the datacenters pause until the fiber is back. The links are sized for this, and the failover exercise tests it ([RES-09](../principles/resilience.md#res-09-resilience-is-tested-not-asserted)).
- **The etcd election timeout and the Patroni leader TTL are longer than the WAN's measured rerouting time.** Otherwise every fiber cut would trigger a needless database failover.
- **The firewall at HQ must allow every declared DC1↔DC2 flow to transit.** A well-meant "lock down HQ" rule would silently bring back the problem described above. The network verification checks this on every policy change.

## The internet

DC1 and DC2 each have an internet connection, used for customer traffic (inbound through the edge load balancers) and for outbound traffic through the egress proxies. HQ's internet connection serves the office only. It is **never** used for quorum or replication.
