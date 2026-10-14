# Network

The network's job at NATAX is to carry the traffic the architecture allows, and nothing else ([SEC-02](../principles/security.md#sec-02-nothing-is-trusted-because-of-where-it-is)). The policy that decides what is allowed is generated from declared intent by [network](../../network/README.md). This page describes the address plan that policy works with.

## Address plan

Each site has a /16. Within the datacenters, the third octet says what kind of thing lives there:

| Range (DC1 / DC2) | Purpose |
|---|---|
| 10.1.10.0/24 · 10.2.10.0/24 | Internet edge: the commercial load balancer appliances |
| 10.1.20.0/24 · 10.2.20.0/24 | Production applications on virtual machines |
| 10.1.25.0/24 · 10.2.25.0/24 | OpenShift clusters (nodes, the shared ingress router, per-namespace egress addresses) |
| 10.1.30.0/24 · 10.2.30.0/24 | Production databases and quorum members |
| 10.1.40.0/24 · 10.2.40.0/24 | Payments zone |
| 10.1.50.0/24 · 10.2.50.0/24 | Platform services: internal load balancers, egress proxies, secret store, observability |
| 10.1.60.0/22 · 10.2.60.0/22 | Test and acceptance environments |

| Range at HQ | Purpose |
|---|---|
| 10.3.70.0/24 | Witness compute: the third quorum members |
| 10.3.90.0/24 | Privileged access workstations (PAWs) |
| 10.3.100.0/22 | Office devices |

| VPN pools | Purpose |
|---|---|
| 10.250.0.0/24 | PAW VPN (device certificate and user identity both required) |
| 10.251.0.0/16 | Workforce VPN |

The ranges are for addressing and routing. They are **not** trust boundaries: a host in 10.1.20.0/24 can reach another host in 10.1.20.0/24 only if a declared flow allows it.

## How traffic flows

- **Customers** reach NATAX only through the edge load balancers (`edge-adc`) in DC1 and DC2.
- **Staff** reach internal applications through the internal load balancers (`platform-lb`), signing in with the workforce IdP.
- **NATAX-managed devices** away from the office (Android phones and tablets) reach only the staff APIs published at the edge (`staff-edge`), with a workforce token from a compliant device. The edge gives them no network trust ([android](../../platforms/android/README.md)).
- **Applications** reach databases only through the database service endpoints on `platform-lb`, never individual database nodes ([RES-05](../principles/resilience.md#res-05-one-writer-at-a-time)).
- **Anything going to the internet** goes through the egress proxies, which allow each service only its declared external destinations ([INT-05](../principles/integration.md#int-05-shared-capabilities-are-used-not-rebuilt)).
- **Administrators** connect only from PAWs, directly to the target ([IAM-06](../principles/identity-and-access.md#iam-06-human-administrative-access-is-just-in-time-and-direct)). There are no jump hosts.
- **Test and acceptance** reach nothing in production ([SEC-07](../principles/security.md#sec-07-test-environments-cant-reach-production)).
- **Traffic between DC1 and DC2** (replication, quorum, applications reaching a database primary in the other datacenter) uses the direct fiber, and transits HQ when the fiber is down ([RES-04](../principles/resilience.md#res-04-three-voting-sites-and-the-witness-is-in-band)).

## Where policy is enforced

Policy is enforced in two places, generated from the same intent:

1. **On every host**, with nftables. Each host accepts only the connections its service has declared. This is what makes the policy Zero Trust rather than zone-based: two hosts on the same subnet can't talk unless a flow allows it.
2. **At HQ's router**, which forwards traffic to and from HQ, and DC1↔DC2 transit, only for declared flows.

The generated rules are in [network/generated](../../network/generated/).

At the application layer, mutual TLS with workload certificates proves which service is calling ([IAM-05](../principles/identity-and-access.md#iam-05-every-workload-has-its-own-identity)). The network limits *who can connect*; workload identity proves *who connected*.

**A known weakness:** OpenShift workloads leave the cluster from per-namespace egress addresses, but they all receive traffic through the cluster's shared ingress router. Host-level policy can't tell one workload from another behind that router, so for OpenShift workloads the cluster's own network policy has to do that job. This is one of the reasons the OpenShift platform is under review (see [accumulated-complexity.md](accumulated-complexity.md)).
