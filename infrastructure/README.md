# Infrastructure: availability, load balancing, capacity

**Always applied**, to every application, by the pipeline. NATAX once bought expensive load balancers and configured health checks that only confirmed a TLS connection opened. On deadline day, that cost 47 minutes of failed filings ([the story](../enterprise-architecture/landscape/accumulated-complexity.md#1-health-checks-that-check-nothing-useful)). The appliances could have done better all along. Meaningful health checks require understanding the application, and the network team didn't own the application.

This architecture closes that gap. The application declares what "healthy" means (in its `architecture.yaml`). The infrastructure configuration is generated from that declaration, and deterministic checks and simulations verify the result. This doesn't need a new platform. It needs a coherent architecture, implemented with the simplest technology that does the job, and tested.

Version: [VERSION](VERSION). Governed by the [central architecture](../enterprise-architecture/README.md). Every application's `architecture.yaml` pins a version of it.

## On every platform

TypeScript web applications get all of it. Power Apps inherit Microsoft 365's availability, accepted once by the Board; the data gateway they use runs in both datacenters. An Android app's availability is its backend's. The details per platform are in [Platforms](../platforms/README.md#how-each-platform-meets-the-always-applied-architecture).

Infrastructure specialists work on this architecture itself, with agents ([BOOTSTRAP.md](BOOTSTRAP.md)).

## How it works

```
 landscape.yaml + every architecture.yaml     (sites, capacity, health, resilience, placement)
                    │
                    ▼
 tools/render.ts ────────▶ generated/haproxy/platform-lb-dc1.cfg, -dc2.cfg   (internal load balancing)
                    │      generated/keepalived/platform-lb-<node>.conf      (VIP failover within a datacenter)
                    │      generated/patroni/<cluster>.yml                    (database failover)
                    │      generated/edge/health-checks.yaml                  (for the commercial appliances, incl. global DNS)
                    │      generated/failure-simulation.md                    (what happens when things fail)
                    ▼
 tools/verify.ts ── health checks, database settings, placement, capacity, quorum topology, drift,
                    and the generated files themselves, read back (tools/check-output.ts)
 tools/simulate.ts ─ failure scenarios, computed from the topology
```

## The failure simulation

[generated/failure-simulation.md](generated/failure-simulation.md) is worth reading. It computes, for each failure scenario, where quorum is, where the database primary ends up, and which datacenters keep serving. Two rows are the point:

| Scenario | Verdict |
|---|---|
| Direct DC1–DC2 fiber cut | **ok**: DC1 and DC2 still reach each other through HQ. Nothing fails over, nothing breaks. |
| The same fiber cut, with an out-of-band witness | **danger**: both datacenters still see the witness but not each other. Every quorum member reports healthy, so nothing fails over. Meanwhile the primary has silently lost its synchronous replica, and DC2 can't reach the primary. A second failure now loses data. |

Same failure, same products, same configuration. The only difference is *how the witness is connected*. That's why [RES-04](../enterprise-architecture/principles/resilience.md#res-04-three-voting-sites-and-the-witness-is-in-band) exists, and why it's checked on every change.

## Checking the output, not the intent

A renderer and a verifier built on the same structures fail together: if the renderer wrote `watchdog: off`, a check of the declared intent would still pass. So [check-output.ts](tools/check-output.ts) reads the generated HAProxy, keepalived, Patroni and edge files back as text, and checks them against the standards and the intent, without the renderer's help. Its tests break the output on purpose (a watchdog turned off, a missing health check, a load balancer sending traffic to the other datacenter) and must catch every one ([DEL-06](../enterprise-architecture/principles/delivery.md#del-06-checks-verify-the-output-not-the-intent-that-produced-it)).

## Try it

```sh
npm install
npm run generate
npm run verify
node infrastructure/tools/simulate.ts
```

Then break something. Set `strict: true` under `app-db.replication` in [landscape.yaml](../enterprise-architecture/landscape/landscape.yaml), or change rejection-triage's health check path to `/`, or raise `filing-web`'s `peak-vcpu` to 1000. The [tests](tools/infrastructure.test.ts) do the same.

## What's here

| File | What it is |
|---|---|
| [standards.md](standards.md) | The rules for this domain (INF-xx) |
| [make-or-buy.md](make-or-buy.md) | The OpenShift reassessment: build versus buy with today's economics |
| [failure-scenarios.md](failure-scenarios.md) | The failure catalog: what must happen, and how it's tested |
| [agents/](agents/README.md) | What the agents do differently in this domain |
| [BOOTSTRAP.md](BOOTSTRAP.md) | Setting up an environment to work on infrastructure |
| [tools/](tools/) | Renderer, verifier, simulator |
| [generated/](generated/) | The output. Never edited by hand. |

## What this example simplifies

- Only the internal load balancers, database failover and edge health checks are generated. Servers, storage, DNS and certificates aren't.
- The simulation models sites and links, not individual servers or partial failures inside a site.
- The configuration is rendered and checked, not deployed. Applying it is the pipeline's job ([SEC-01](../enterprise-architecture/principles/security.md#sec-01-only-the-central-pipeline-changes-production)).
