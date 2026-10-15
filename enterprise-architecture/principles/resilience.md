# Resilience (RES)

High availability and disaster recovery aren't separate disciplines at NATAX. Both are about one thing: does the service keep doing its job when something fails? A failed disk, a failed server, a failed link and a failed datacenter are failure scenarios of different sizes, not different subjects.

So the architecture describes the **resilience the service needs**, not the products that provide it. The [infrastructure](../../infrastructure/README.md) architecture translates that into designs and configuration, and tests verify the behavior.

These rules are written for applications. Platform services (database clusters, quorum members, load balancers) meet the same intent through their own mechanisms, which the [infrastructure](../../infrastructure/README.md) architecture defines.

## The NATAX topology in brief

Three sites, connected by one routed network (details in [landscape/sites.md](../landscape/sites.md)):

- **DC1** and **DC2**: datacenters, both running production, active/active.
- **HQ**: the headquarters office building. It has minimal compute: it is the third voting site for quorum, and nothing more.

## Resilience classes

| Class | For | Survives without manual action | Data loss on site loss | Service restored within | Example |
|---|---|---|---|---|---|
| **A** | Taxpayers can't file, pay or sign in without it | Loss of any one component, link or site | None (one failure at a time, see RES-05) | 5 minutes | filing-web, efile-gateway, customer-idp |
| **B** | NATAX staff can't support filing without it | Loss of any one component, link or site | None (one failure at a time, see RES-05) | 30 minutes | rejection-triage, notification-service |
| **C** | Everything else | Loss of any one component | Up to 24 hours (restore from backup) | Next business day | Internal reporting |

The restore times apply to failures that are handled automatically: failover, readiness, automatic rollback. Recovering from a defect in the application itself also depends on who responds ([OWN-07](ownership.md#own-07-operational-response-matches-resilience-class)).

The class sets a minimum. The standard platform often does better at no extra cost: every database on the standard PostgreSQL clusters gets synchronous replication, class C included.

## The planning peak

NATAX's peak is the filing deadline. The **planning peak** is 1.5 times the previous year's measured peak load. It already includes headroom; nothing below adds more on top.

### RES-01: Every service states its resilience in business terms
**Rule.** Each application's `architecture.yaml` states its resilience class *and* a plain-language statement from the Problem Owner. The statement says how long users can manage without the service, how much recent data they could afford to lose, and when it matters most. Example: *"During filing season, support agents can fall back to the Tax Authority's portal for about 30 minutes before the rejection queue becomes unmanageable."*
**Why.** "We need five nines" is not a requirement. "Agents can cope for 30 minutes" is, and it can be tested and turned into a class.
**Verified by.** `test`: presence. `review`: the Governance Agent checks that the class matches the statement.

### RES-02: DC1 and DC2 are both production, all the time
**Rule.** Class A and B services run instances in both DC1 and DC2, and both sets serve traffic all the time. Users reach both datacenters through DNS-based global load balancing driven by the same readiness checks as the local load balancers (TTL of 30 seconds or less). A datacenter whose instances of a service aren't ready is withdrawn for that service within 60 seconds. Neither datacenter is a "DR site". Class C services may run in one datacenter only.

Databases have one writer at a time (RES-05), so the data tier is proven differently: every database primary is moved to the other datacenter by a planned switchover once a month.
**Why.** A standby site is a site whose ability to take over is assumed, not proven. Active/active compute proves the application tier every day; monthly switchovers prove the data tier.
**Verified by.** `test`: infrastructure configuration checks that class A and B services have serving instances in both datacenters. Switchover records are an input to the pipeline.

### RES-03: One datacenter carries the whole peak
**Rule.** Each datacenter can run all class A and B production services at the planning peak on its own. Production instances in both datacenters are always deployed at that size, so losing a datacenter starts or resizes nothing in production. Test and acceptance environments run on the same hosts at lower scheduling priority, using the capacity production reserves but doesn't use in normal operation. When a datacenter is lost, the surviving one's production gets busy, and its test, acceptance and class C workloads are suspended to give the CPU back. Production keeps its full performance; test and acceptance are what degrade.
**Why.** Starting or resizing production during a datacenter loss is reactive scaling at the worst possible moment. Capacity that's idle except in a disaster is expensive. Lending it to test and acceptance keeps it busy, and the priority order makes clear who gets it back.
**Verified by.** `test`: capacity calculations from the infrastructure configuration (see [infrastructure](../../infrastructure/README.md)). Suspending test and acceptance is exercised in the site failover tests (RES-09).

### RES-04: Three voting sites, and the witness is in-band
**Rule.** Distributed coordination whose failure could create two authoritative writers (database failover, consensus stores) uses majority quorum across three voting sites: DC1, DC2 and HQ. Each voting site has one member.

The witness at HQ must be **in-band**: it is reachable only over the same routed network that connects DC1 and DC2, and HQ forwards **every declared DC1↔DC2 flow** when their direct link is down. A witness reachable over a separate path (an internet connection, the management network, a cellular link or a cloud service) isn't allowed.
**Why.** Majority quorum and fencing stop two primaries from accepting writes at once. They don't stop a subtler failure. If the witness has its own separate path, cutting the direct DC1–DC2 link leaves **both datacenters seeing the witness but not each other**. Every member still has quorum, so nothing fails over. Meanwhile, the synchronous replica can't receive changes, applications in one datacenter can't reach the primary in the other, and the only automation that could react sees a healthy cluster. With simpler witnesses (storage tiebreakers, file-share witnesses), the same state can also lead to split brain.

With an in-band witness, reachability is transitive: if DC1 and DC2 can both reach HQ, they can reach each other through HQ. A clean partition can isolate at most one site, and that site loses quorum and stops accepting writes, which is exactly what should happen. Partial failures (a rule that drops replication but not quorum) are still possible. That is why both the policy check and the fiber-cut exercise exist.

This also means a network policy can break resilience. A firewall rule at HQ that blocks DC1↔DC2 transit quietly brings back the problem. The [network](../../network/README.md) and [infrastructure](../../infrastructure/README.md) tests both check for it.
**Verified by.** `test`: a topology check (voting members depend only on in-band links, and HQ routes transit) and a policy check (every declared DC1↔DC2 flow may transit HQ). Both run on every change to network or infrastructure configuration. The failover exercise (RES-09) includes cutting the direct DC1–DC2 link.

### RES-05: One writer at a time
**Rule.** Data stores have a single writer: one primary, a synchronous replica in the other datacenter, and automatic failover coordinated by the three-site quorum (RES-04). Only the synchronous replica may be promoted. A hardware watchdog fences a primary that loses its leader lock. Applications reach the database only through its service endpoint, which always points to the current primary, never through an individual node's address.

Synchronous replication is **non-strict**: if the replica or its datacenter is lost, the primary continues alone rather than stopping all writes. Zero data loss therefore holds for one failure at a time. Running without a synchronous replica is a class A incident until the replica is rebuilt. With one database node per datacenter, a single server failure moves the primary to the other datacenter.

Multi-writer (active/active writes) designs require a decision record demonstrating a requirement that single-writer can't meet.
**Why.** Multi-writer replication trades a well-understood problem (failover takes seconds) for a badly understood one (conflicting writes, forever). Active/active *compute* in front of a single-writer database gives NATAX the availability it needs. Strict synchronous replication would turn every replica failure into a full outage, which is the wrong trade for NATAX.
**Verified by.** `test`: the network policy allows applications to reach database nodes only through the service endpoint. The [infrastructure](../../infrastructure/README.md) checks verify the database configuration (synchronous mode, watchdog, promotion rules), and failover tests check that acknowledged transactions survive and the old primary is fenced.

### RES-06: Healthy means ready to serve
**Rule.** Every service exposes two health endpoints:

- **Liveness** (`/health/live`): the process is running and not deadlocked. It never checks dependencies. A failure means "restart me".
- **Readiness** (`/health/ready`): this instance can do its job *right now*. It checks the dependencies the service can't work without (for example, its database), with short timeouts, caching results for at most 5 seconds. It doesn't check dependencies the service can degrade without, and it never calls another service's readiness endpoint, which would chain failures across services. A failure means "send traffic elsewhere".

Load balancers route on readiness. A health check that only confirms a port is open, or that a TLS handshake succeeds, doesn't satisfy this rule.

A busy instance is not an unready one. Health checks are exempt from load shedding, and readiness checks whether a dependency can be *reached*, not whether a pool is momentarily full. Otherwise, a load spike would make every instance unready at once, and the load balancer would take them all out. Overload is handled by fast rejections instead (RES-08).
**Why.** NATAX learned this the hard way: on deadline day, load balancers kept sending traffic to instances that had lost their connection to the database. The instances accepted connections, so the health check said they were "up", and filings failed. See [landscape/accumulated-complexity.md](../landscape/accumulated-complexity.md).
**Verified by.** `test`: load balancer configuration checks in [infrastructure](../../infrastructure/README.md). The Test Agent checks that readiness fails when critical dependencies fail.

### RES-07: Degrade visibly instead of failing completely
**Rule.** When a non-critical dependency fails, the service keeps its core function and tells users what is unavailable. Example: if the e-file gateway is down, rejection-triage still shows and updates the existing queue, with a banner saying new rejections aren't being loaded.
**Why.** Partial service is better than no service, but only if users know it's partial.
**Verified by.** `test`: the Test Agent tests every declared dependency failure.

### RES-08: Everything is bounded
**Rule.** Every outbound call has a timeout. Every pool, queue and buffer has a maximum size. When limits are reached, the service rejects excess work quickly with a clear error (HTTP 503 with `Retry-After`), rather than queuing it until everything times out. Retries use exponential backoff with jitter and a retry budget.
**Why.** An overloaded service that fails fast recovers. One that queues indefinitely fails slowly, and takes its callers down with it.
**Verified by.** `test`: the Test Agent includes overload tests. `review`.

### RES-09: Resilience is tested, not asserted
**Rule.** Failure scenarios are defined in the [infrastructure failure catalog](../../infrastructure/failure-scenarios.md) and tested:

- On every relevant change: component failures in acceptance (instance loss, database failover, dependency failure).
- Every month: a planned switchover of every database primary (RES-02).
- Twice a year in production: a full site failover exercise, including cutting the direct DC1–DC2 link and losing HQ. One of the two exercises happens at least six weeks before the filing deadline.
- Every week: automated backup restore tests ([DAT-08](data.md#dat-08-a-backup-isnt-a-backup-until-it-has-been-restored)).

A failover that hasn't been tested is treated as not working.
**Why.** Every untested failover design is a hypothesis.
**Verified by.** `test`: the pipeline records the date and result of each exercise. A class A or B service whose last site failover exercise failed or is more than seven months old can only release fixes.

### RES-10: Known peaks are provisioned for, not hoped for
**Rule.** Capacity for the planning peak is provisioned in advance, and verified at least six weeks before the deadline by a load test of one datacenter at the planning peak. The test runs in production, outside the filing season: one datacenter is drained of real traffic and loaded with synthetic filings from accounts marked as synthetic, which the efile gateway never submits. Autoscaling is not a substitute for a capacity plan.
**Why.** Elastic scaling solves unpredictable load. NATAX's load is predictable a year in advance, and on the one day it matters, "we'll scale when it happens" is a bet NATAX can't afford to lose. Only production is big enough to prove production's capacity.
**Verified by.** `test`: load test results are an input to the pipeline from six weeks before the deadline onwards.

### RES-11: SaaS platforms and devices
**Rule.** RES-02 to RES-10 describe services that NATAX runs in DC1 and DC2. Two kinds of application don't run there, and the Board decides once, per platform, what applies to them instead:

- **On a SaaS platform**, an application inherits the platform's availability: NATAX can't fail it over, test it or add capacity to it. The Board accepts that dependency once, for the whole platform, in the platform's architecture, with limits that keep the risk proportionate. Today that is Power Apps on Microsoft 365 ([power-apps](../../platforms/power-apps/README.md)): class B or C only, never class A. On a SaaS platform the class doesn't promise the table's restore times or data loss, which are the provider's; it sets the support hours ([OWN-07](ownership.md#own-07-operational-response-matches-resilience-class)), the change freeze around the deadline, and how much the Problem Owner may depend on it. The resilience statement says explicitly that "when Microsoft 365 is down, this is down", and what users do then.
- **On a device**, an application's availability is its backend's. The backend is a NATAX service, and RES-01 to RES-10 apply to it in full. The app itself must keep working without its backend for as long as its users need ([android](../../platforms/android/README.md)), and never holds the only copy of anything.

For both, RES-01, RES-07 and RES-08 apply as written; RES-02 to RES-06, RES-09 and RES-10 apply to the NATAX components the application uses (its backend, the APIs it calls), not to the application. The details per platform are in [Platforms](../../platforms/README.md#central-rules-that-work-differently-per-platform).
**Why.** NATAX already depends on Microsoft 365 for email, documents and sign-in; when it's down, most office work stops anyway. Pretending a Power App needs two datacenters would be architecture describing an environment that doesn't exist. Accepting the dependency once, with clear limits, is honest. Repeating the same exception on every Power App would hide the decision. A phone in a field office is never highly available; the system it talks to can be.
**Verified by.** `test`: the platform's limits in `platform.yaml` are checked on every release (validate-manifest). `review`: the resilience statement accepts the dependency, or describes what the app does without its backend.

