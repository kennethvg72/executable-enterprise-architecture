# Infrastructure standards (INF)

These rules implement the central [resilience](../enterprise-architecture/principles/resilience.md) principles, along with [SIM-03](../enterprise-architecture/principles/simplicity.md#sim-03-decide-build-versus-buy-on-todays-economics), [SIM-04](../enterprise-architecture/principles/simplicity.md#sim-04-use-what-natax-already-owns-fully) and [DEL-04](../enterprise-architecture/principles/delivery.md#del-04-infrastructure-and-network-are-code). They describe the resilience a service needs and how NATAX delivers it, not a product catalog.

### INF-01: The default runtime is a process on a virtual machine
**Rule.** Applications run as processes on virtual machines, supervised by systemd, deployed by the pipeline, behind HAProxy. Containers are fine as a packaging format. A container orchestrator (Kubernetes, OpenShift) requires a decision record showing a requirement the default can't meet ([SIM-01](../enterprise-architecture/principles/simplicity.md#sim-01-every-component-must-earn-its-place)).
**Why.** NATAX's peak is predictable to the day, and its applications are few enough to deploy individually. An orchestrator solves problems NATAX mostly doesn't have, and adds a platform to run, secure and upgrade. See [make-or-buy.md](make-or-buy.md).
**Verified by.** `review`.

### INF-02: Health checks are declared by the application and generated for every load balancer
**Rule.** Each interface an application publishes declares its readiness endpoint in `architecture.yaml` (`health: { port, path }`). Configuration for HAProxy and the edge appliances is generated from that declaration. Readiness is checked every 2 seconds; 3 failures take an instance out and 2 successes put it back.
**Why.** The team that knows what "healthy" means writes it down once, and every load balancer uses it. This is how NATAX finally uses what it already owns ([SIM-04](../enterprise-architecture/principles/simplicity.md#sim-04-use-what-natax-already-owns-fully)).
**Verified by.** `test`: [verify.ts](tools/verify.ts) checks every generated backend.

### INF-03: Local first, the other datacenter as backup
**Rule.** Each datacenter's internal load balancer sends traffic to instances in its own datacenter, and to the other datacenter's instances only when no local instance is ready. Global load balancing (DNS, driven by the same readiness checks) spreads users across both datacenters ([RES-02](../enterprise-architecture/principles/resilience.md#res-02-dc1-and-dc2-are-both-production-all-the-time)).
**Why.** Local traffic is faster and keeps working when the link between datacenters is degraded. The backup path keeps the service up while one instance is replaced.
**Verified by.** `test`: rendering.

### INF-04: Load balancers protect against overload
**Rule.** Every backend has a per-server connection limit and a queue timeout of 2 seconds. Requests beyond that get an immediate 503 rather than waiting ([RES-08](../enterprise-architecture/principles/resilience.md#res-08-everything-is-bounded)).
**Why.** On deadline day, a queue that grows without limit turns a slowdown into an outage.
**Verified by.** `test`: rendering.

### INF-05: PostgreSQL failover uses Patroni, with etcd across three sites
**Rule.** Each PostgreSQL cluster has one node in each datacenter, managed by Patroni, with one etcd member in each of DC1, DC2 and HQ. Settings: `synchronous_mode: true`, `synchronous_mode_strict: false`, watchdog `required`, and a leader TTL longer than the WAN's measured rerouting time. Applications connect through the HAProxy database endpoint, which checks Patroni's `/primary` and cuts connections to a demoted primary. Every primary is switched over to the other datacenter once a month. The settings Patroni keeps in etcd are applied to the running cluster, not only at its creation: `bootstrap.dcs` counts only once, so the deployment process applies `patroni/<cluster>.dcs.yml` with `patronictl edit-config`, and after every apply, and daily, the running cluster's `GET /config` must show the same values ([check-patroni-config.ts](tools/check-patroni-config.ts)): a pipeline step, not a cron wish. `--apply` merges, so settings the cluster keeps for itself survive, and are reported. `max_connections` is declared per cluster and checked against every consumer's pool, readiness and a reserve. WAL and backups go to pgBackRest repositories in both datacenters, with a queue limit, so the surviving primary keeps archiving and an unreachable repository can't fill its disk (DAT-08). The clusters share the etcd quorum, so each has its own etcd identity that can touch only its own keys (`etcd/rbac.yaml`): one cluster can never take another's leader lock.
**Why.** This is the simplest arrangement that meets [RES-04](../enterprise-architecture/principles/resilience.md#res-04-three-voting-sites-and-the-witness-is-in-band) and [RES-05](../enterprise-architecture/principles/resilience.md#res-05-one-writer-at-a-time): well understood, widely used, and requiring no shared storage or product licenses.
**Verified by.** `test`: [verify.ts](tools/verify.ts) checks the settings, and the database endpoints.

### INF-06: Backups go to immutable storage in the other datacenter
**Rule.** PostgreSQL is backed up continuously (base backups plus write-ahead log archiving) to object storage in the other datacenter, with object lock enabled for the full retention period ([DAT-08](../enterprise-architecture/principles/data.md#dat-08-a-backup-isnt-a-backup-until-it-has-been-restored)). The backup tool runs with an identity that can write new backups but not delete or shorten existing ones.
**Why.** The backup must survive both the loss of a datacenter and a compromised administrator or pipeline.
**Verified by.** `test`: weekly restore tests; storage configuration checks.

### INF-07: Capacity is reserved for the planning peak, in each datacenter
**Rule.** Each class A and B service declares `peak-vcpu`: the vCPU it needs to carry the planning peak from one datacenter. Each datacenter must fit the sum of those reservations plus its own class C services. Test and acceptance run at lower priority on what production reserves but doesn't use ([RES-03](../enterprise-architecture/principles/resilience.md#res-03-one-datacenter-carries-the-whole-peak)).
**Why.** It makes "can one datacenter carry the deadline?" a sum that's checked on every change, rather than a hope.
**Verified by.** `test`: [verify.ts](tools/verify.ts).

### INF-08: Failure scenarios are simulated on every change and exercised on a schedule
**Rule.** Every change to sites, links, quorum members or database clusters runs the [failure simulation](tools/simulate.ts). The scenarios in [failure-scenarios.md](failure-scenarios.md) are exercised for real on the schedule in [RES-09](../enterprise-architecture/principles/resilience.md#res-09-resilience-is-tested-not-asserted).
**Why.** The simulation catches design mistakes in seconds. The exercises catch everything the simulation can't model.
**Verified by.** `test`.
