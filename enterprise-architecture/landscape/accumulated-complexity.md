# Accumulated complexity

NATAX is twenty years old. Some of its complexity is essential: tax is complicated, and so is filing it on behalf of millions of people. Much of it simply accumulated. This page lists the biggest items honestly, with what is being done about each. The Board reviews it every year before the filing season ([architecture review](../governance/architecture-review.md)).

Every item has an owner and a date ([SIM-07](../principles/simplicity.md#sim-07-temporary-complexity-has-an-owner-and-an-end-date)).

## 1. Health checks that check nothing useful

**What.** The commercial load balancers at the internet edge (`edge-adc`) check filing-web, advisor-portal and customer-idp by opening a TLS connection. If the handshake succeeds, the instance is "up".

**What happened.** On last year's deadline day, at 21:40, a firewall change cut the filing-web instances in DC2 off from the database. They still accepted TLS connections, so the load balancers kept sending them half of all traffic. Filings failed for 47 minutes until someone found the cause by hand. The appliances could have checked readiness all along. Nobody had configured them to, because the network team didn't own the application and the application team didn't own the load balancer.

**What's being done.** Health checks are now specified once, vendor-neutrally, in each application's intent and generated into load balancer configuration ([infrastructure](../../infrastructure/README.md), [RES-06](../principles/resilience.md#res-06-healthy-means-ready-to-serve)). The edge appliances move to readiness checks for all class A services before the next filing season. **Owner:** Jordan Alvarez. **Date:** 2027-02-01.

## 2. A container platform for a problem NATAX doesn't have

**What.** Two OpenShift clusters, one per datacenter, bought three years ago for "elastic scaling during the filing season". They run four workloads: advisor-portal and three internal tools. Running them takes most of the time of three platform engineers, plus a substantial subscription.

**Why it's in question.** NATAX's peak is predictable to the day ([RES-10](../principles/resilience.md#res-10-known-peaks-are-provisioned-for-not-hoped-for)), so elasticity isn't the problem it was bought to solve. Host-level network policy can't tell workloads apart behind the clusters' shared ingress (see [network](network.md)). Everything else NATAX runs is processes on virtual machines, behind HAProxy, deployed by the pipeline.

**What's being done.** A build-versus-buy reassessment ([SIM-03](../principles/simplicity.md#sim-03-decide-build-versus-buy-on-todays-economics)), worked through in [infrastructure/make-or-buy.md](../../infrastructure/make-or-buy.md). **Owner:** Jordan Alvarez. **Decision by:** 2027-01-15.

## 3. The calculation engine nobody dares touch

**What.** `calc-engine`, fifteen years of Java, with tax rules for every year since it was written. Few automated tests. Changes are released quarterly because each release needs two weeks of manual regression testing. It uses TLS 1.2 internally, and the integration broker.

**What's being done.** The Test Agent is mining the engine's behavior into characterization tests: thousands of synthetic returns with known results, covering every tax year it supports. Once those tests exist, the engine can be changed safely, and eventually rebuilt piece by piece against them. The old code is evidence of intent, not a specification: every surprising behavior goes to the Tax Content team as a question. **Owner:** Hanna van Dijk. **Characterization tests complete by:** 2027-03-31. **TLS 1.3 by:** 2027-06-30.

## 4. The integration broker

**What.** A message broker installed eleven years ago to connect the calc engine, the efile gateway and the data warehouse. Its routing configuration is understood by one person.

**What's being done.** Contained ([INT-02](../principles/integration.md#int-02-synchronous-http-first-a-queue-in-postgresql-second-a-broker-last)): no new consumers. Each existing integration moves to an API or a PostgreSQL-backed queue in the first release that changes its integration code. **Owner:** Jordan Alvarez. **Removal by:** 2027-12-31.

## 5. The data warehouse has copies it shouldn't

**What.** The data warehouse receives full copies of submissions through the broker, including taxpayer identifiers. That violates [DAT-02](../principles/data.md#dat-02-collect-and-copy-only-what-the-purpose-needs), and the warehouse runs in DC1 only, as class C.

**What's being done.** A time-boxed Board exception, EXC-2026-003 in [exceptions/data-warehouse.yaml](../governance/exceptions/data-warehouse.yaml), expiring 2027-06-30, with compensating controls: access limited to four named analysts, quarterly access review, encryption at rest. The replacement feeds the warehouse filing references and aggregates only. **Owner:** Robin Cho.

## 6. Two kinds of load balancer

**What.** Commercial appliances at the internet edge, HAProxy internally.

**Why it stays (for now).** This one is deliberate. The appliances' web application firewall, DDoS protection and global load balancing are licensed and used, and the internet edge needs them. Internal traffic doesn't, and HAProxy configured from the same intent costs nothing in licenses. Both are generated from the same vendor-neutral health check specification. **Owner:** Jordan Alvarez. **Review by:** 2028-03-31, when the appliance contract ends.

## 7. The last of the flat network

**What.** Until last year, any host in a datacenter could reach any other, and administrators connected through two shared jump hosts.

**What's being done.** The jump hosts were decommissioned in June ([IAM-06](../principles/identity-and-access.md#iam-06-human-administrative-access-is-just-in-time-and-direct)). Host-level policy generated from declared intent ([network](../../network/README.md)) now covers all services in [landscape.yaml](landscape.yaml). OpenShift workloads are the remaining gap; they are resolved by the decision on item 2. **Owner:** Jordan Alvarez. **Date:** 2027-01-15.
