# Failure catalog

What must happen when things fail, and how NATAX knows it does. Every scenario is tested in at least one way ([RES-09](../enterprise-architecture/principles/resilience.md#res-09-resilience-is-tested-not-asserted)):

- **Sim**: the deterministic [simulation](tools/simulate.ts), on every relevant change. Results: [generated/failure-simulation.md](generated/failure-simulation.md).
- **App**: the application's own tests, on every release candidate.
- **Acc**: the Test Agent's tests in acceptance, on every relevant release candidate, recorded as its evidence and audited ([DEL-02](../enterprise-architecture/principles/delivery.md#del-02-tests-are-part-of-the-change)).
- **Prod**: an exercise in production, on the schedule shown.

| ID | Scenario | What must happen | Tested |
|---|---|---|---|
| FS-01 | An application instance crashes | Readiness fails, so the load balancer stops sending it traffic within 6 seconds (2 s interval × 3 failures). Users of the other instances notice nothing. systemd restarts the process. | Acc |
| FS-02 | An instance is up, but can't reach its database (the deadline-day failure) | Readiness fails, because it checks the database on a connection of its own. The instance is taken out of rotation, and the other instances carry the load. | App, Acc |
| FS-02b | Every instance is overloaded (a load spike) | Readiness stays healthy, so no instance is taken out. Excess requests get an immediate 503 with `Retry-After` (FS-04). | App |
| FS-03 | A non-critical dependency is down (for rejection-triage: the efile gateway) | Readiness stays healthy. The application keeps its core function and tells users what is unavailable ([RES-07](../enterprise-architecture/principles/resilience.md#res-07-degrade-visibly-instead-of-failing-completely)). | App |
| FS-04 | Overload: more requests than the planning peak | Excess requests get an immediate 503 with `Retry-After`. Latency for accepted requests stays normal. | App, Acc |
| FS-05 | The database primary's server fails | Patroni promotes the synchronous replica in the other datacenter. HAProxy's `/primary` check moves the endpoint within seconds, and cuts connections to the old primary. Acknowledged transactions survive. Applications reconnect. | Acc; Prod (monthly switchover) |
| FS-06 | Planned database switchover | As FS-05, without data loss and with a brief pause in writes. | Prod, monthly |
| FS-07 | Direct DC1–DC2 fiber cut | Traffic between the datacenters reroutes through HQ. Nothing fails over. Replication stays synchronous. Backups between the datacenters pause. | Sim; Prod, twice a year |
| FS-08 | HQ lost | Quorum continues with two of three voting sites. Nothing fails over. No tolerance for a second failure until HQ is back. | Sim; Prod, twice a year |
| FS-09 | A datacenter lost | The surviving datacenter keeps or takes over every database primary, serves all users at the planning peak if needed, and suspends test and acceptance. | Sim; Prod, twice a year (one exercise six weeks before the deadline) |
| FS-10 | A datacenter isolated (both of its WAN links cut) | The isolated datacenter loses quorum, and its primaries fence themselves. Its applications fail readiness, because they can't reach a primary, so global load balancing withdraws it. The other datacenter serves everything. | Sim; Acc (network partition test) |
| FS-11 | The witness connected out of band, then a fiber cut | **Must not be possible**: the topology check rejects an out-of-band witness ([RES-04](../enterprise-architecture/principles/resilience.md#res-04-three-voting-sites-and-the-witness-is-in-band)). The simulation shows why. | Sim |
| FS-12 | Two failures at once (HQ lost and the fiber cut) | Beyond the design. No site has quorum, so writes stop everywhere: an outage, but never split brain. Recovery is a manual decision, made with the database specialists, following the runbook. | Sim |
| FS-13 | Data deleted or corrupted by mistake or by an attacker | Restore from immutable backups to a point in time before the damage ([INF-06](standards.md#inf-06-backups-go-to-immutable-storage-in-the-other-datacenter)). | Prod, weekly restore tests |

## When an exercise fails

An exercise that fails is a success for the process: it found something before a real failure did. Record the result in the affected application's repository, and classify the cause in the same way as for network policy ([ZTN-08](../network/standards.md#ztn-08-when-the-policy-breaks-something-legitimate-find-out-which-of-three-things-was-wrong)): was the implementation wrong, were the requirements incomplete, or does the architecture need to improve?
