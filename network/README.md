# Network: Zero Trust

**Always applied**, to every application on every platform, by the pipeline. The principle is simple: every connection is explicitly authorized, based on the identities, services and resources involved ([SEC-02](../enterprise-architecture/principles/security.md#sec-02-nothing-is-trusted-because-of-where-it-is)). The implementation usually isn't. There are thousands of paths, many of them undocumented, and every policy has to be built, tested and kept up to date. So organizations settle for broad network access. That isn't because the technology can't do better; it's because the policies cost too much to build and maintain.

This architecture makes them cheap. Nobody writes firewall rules by hand. Services declare what they need, the rules are generated from the declarations, and deterministic tests check the result: both that legitimate traffic works and that everything else is blocked.

Version: [VERSION](VERSION). Governed by the [central architecture](../enterprise-architecture/README.md). Every application's `architecture.yaml` pins a version of it.

## On every platform

TypeScript web applications get generated host firewalls; Power Apps reach NATAX only through the data gateway, a host in this policy like any other; Android devices get no network trust at all, only APIs at the edge. The details per platform are in [Platforms](../platforms/README.md#how-each-platform-meets-the-always-applied-architecture).

Network specialists work on this architecture itself, with agents ([BOOTSTRAP.md](BOOTSTRAP.md)): the landscape, the compiler, the tests.

## How it works

```
 landscape.yaml + every architecture.yaml          (declared intent: who needs what, and why)
                    │
                    ▼
 tools/compile.ts ─────────────▶ generated/nftables/<service>.nft   (one default-deny ruleset per host)
                    │            generated/nftables/hq-router.nft    (HQ's forwarding, incl. DC1<->DC2 transit)
                    │            generated/egress-proxy/allowlist.yaml
                    │            generated/flows.md                  (every allowed flow, and why)
                    │            generated/probes.json               (thousands of probes, with expected outcomes)
                    ▼
 tools/verify.ts ── invariants (rules for any landscape) + expectations.yaml (the Test Agent's) + drift
                    │
                    ▼
 tools/probe.ts ─── runs the probes from each vantage point in a lab, test, acceptance or production
                    │
 tools/analyze-flows.ts ── compares observed traffic with intent: evidence, not permission
```

A flow exists only when **both sides declare it**: the consumer in its `consumes`, and the provider by listing the consumer in `provides.consumers`. Zero Trust works in both directions. Rejection-triage can't reach the efile gateway's rejections API until the efile gateway's owner agrees.

## Try it

```sh
npm install
npm run generate                 # compile intent into policy and probes
npm run verify                   # invariants, expectations, drift (network and infrastructure)
node network/tools/analyze-flows.ts network/observed/flowlog-sample.csv
```

Then try breaking something, and watch the checks catch it:

- In [landscape.yaml](../enterprise-architecture/landscape/landscape.yaml), set `hq.transit: false`. The RES-04 check fails: losing the direct DC1–DC2 link would now leave both datacenters seeing the witness but not each other.
- Remove `rejection-triage` from the efile gateway's `rejections-api` consumers. The compiler refuses, and says whose approval is missing.
- Add `- { from: data-warehouse, to: all-production, port: 22, purpose: Handy admin box }` to `platform-flows`. That's a jump host, and IAM-06 fails.

The [tests](tools/network.test.ts) do exactly this kind of thing, deterministically.

## What's here

| File | What it is |
|---|---|
| [standards.md](standards.md) | The rules for this domain (ZTN-xx), on top of the central ones |
| [rollout.md](rollout.md) | How to get from a flat network to this, without breaking production |
| [expectations.yaml](expectations.yaml) | The Test Agent's explicit expectations, independent of the compiler |
| [agents/](agents/README.md) | What the agents do differently in this domain |
| [BOOTSTRAP.md](BOOTSTRAP.md) | Setting up an environment to work on network policy |
| [tools/](tools/) | The compiler, verifier, prober and flow analyzer |
| [generated/](generated/) | The output. Never edited by hand ([DEL-04](../enterprise-architecture/principles/delivery.md#del-04-infrastructure-and-network-are-code)). |
| [observed/](observed/) | A sample flow log, and the analyzer's report on it |
| [findings.md](findings.md) | What broke, or was found, and which of the three causes it was (ZTN-08) |

## What this example simplifies

- Addresses stand in for identities at the network layer. Workload identity at the application layer (mTLS, [IAM-05](../enterprise-architecture/principles/identity-and-access.md#iam-05-every-workload-has-its-own-identity)) is the other half, and isn't generated here.
- DNS, NTP, the certificate authority and similar basics are left out of the landscape.
- IPv4 only. Enforcement is rendered for nftables. Rendering the same policy for a commercial firewall, or for Kubernetes network policy, is a different renderer over the same compiled flows.
