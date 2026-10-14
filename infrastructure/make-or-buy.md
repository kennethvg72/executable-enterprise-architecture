# Make or buy: does NATAX need OpenShift?

A worked example of [SIM-03](../enterprise-architecture/principles/simplicity.md#sim-03-decide-build-versus-buy-on-todays-economics): reconsider a platform decision using today's economics, not the assumptions from when it was made. This is the analysis behind item 2 of the [accumulated complexity](../enterprise-architecture/landscape/accumulated-complexity.md#2-a-container-platform-for-a-problem-natax-doesnt-have) list. The Board decides by 2027-01-15.

OpenShift is a capable platform, and this isn't an argument against it in general. The question is narrower: **does NATAX need it, for these workloads, today?**

## Why it was bought

Three years ago, the argument was elastic scaling for the filing season, plus a standard way to run containers. At the time, building the alternative (deployment automation, load balancer integration, health-checked rollouts, monitoring) would have taken a team months, and a platform that included all of it made economic sense.

## What changed

1. **The peak turned out to be predictable**, to the day. NATAX now provisions for the planning peak in advance ([RES-10](../enterprise-architecture/principles/resilience.md#res-10-known-peaks-are-provisioned-for-not-hoped-for)), so the elasticity isn't used.
2. **The alternative now exists anyway.** The pipeline deploys to virtual machines, HAProxy configuration and health checks are generated from intent ([INF-02](standards.md#inf-02-health-checks-are-declared-by-the-application-and-generated-for-every-load-balancer)), and network policy is generated per host. Everything outside OpenShift already runs this way.
3. **Building and migrating is much cheaper** with AI-assisted engineering. What used to be a team-months project is now days of agent work plus human review per workload.

## The comparison

| | Keep OpenShift | Move the four workloads to the default runtime |
|---|---|---|
| Recurring cost | Subscription, plus most of the time of three platform engineers for upgrades, certificates, operators and the cluster's own monitoring | Four more services on the existing virtual machine platform; no new skills or tooling |
| One-time cost | None | Migrating four workloads: packaging, `architecture.yaml`, tests, cut-over. Estimated by agents at a few days each, with today's economics. |
| Zero Trust | Workloads hide behind a shared ingress router; network policy has to be done twice, inside and outside the cluster | Every workload has its own addresses and host policy, generated like everything else |
| Failure modes | The cluster itself can fail, and has, during upgrades | No extra layer |
| Skills | OpenShift operations is a specialty, and scarce | Linux, systemd and HAProxy, which every NATAX engineer already knows |
| Exit cost later | Grows with every workload added | — |

## What would change the answer

None of this is dogma. Keeping, or even expanding, a container platform would make sense if NATAX had:

- many services that scale independently and unpredictably,
- a need to pack many small workloads densely onto shared hardware,
- or teams deploying dozens of times a day in ways the pipeline can't support.

None of these is true today. If they become true, this analysis should be redone.

## Proposal to the Board

Move the four workloads to the default runtime, one at a time, starting with the three internal tools and ending with advisor-portal (class A), outside the filing season. Decommission both clusters once they are empty. Re-run this analysis if the conditions above change.
