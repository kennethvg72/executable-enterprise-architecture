# Ownership (OWN)

An application that belongs to everyone belongs to no one. At NATAX, every application has a person who owns the problem it solves. When nobody owns it anymore, it goes.

## Roles

- **Problem Owner.** The person who owns the problem the application solves. They decide what it should do and accept or reject its behavior. They do not need to be a developer, and they never need production rights.
- **Technical Owner.** A professional engineering team accountable for the application's technical health. It is required for resilience class A (see [resilience](resilience.md)), and optional otherwise.
- **Platform Owner.** Central IT owns the shared platforms: datacenters, network, the PostgreSQL clusters, load balancers, identity, the pipeline. Applications use the platforms but don't operate them.

### OWN-01: Every application has a named Problem Owner
**Rule.** Every application's `architecture.yaml` names one Problem Owner: a person, not a team, a role or a mailbox. That person must be an active employee in the workforce directory.
**Why.** Accountability that is shared is accountability that is avoided. A person can be asked what an application is for. A mailbox can't.
**Verified by.** `test`: the pipeline checks the Problem Owner against the workforce directory on every release. A scheduled job checks every application weekly.

### OWN-02: No owner means decommission
**Rule.** When a Problem Owner leaves or steps down, the application has 30 days to get a new one. After that, Central IT starts decommissioning it: it is frozen (no releases except security fixes), its users are notified, and it is removed 60 days later unless someone takes ownership. While an application has no Problem Owner, Central IT acts as its custodian: it may release security fixes and the decommissioning itself, without a Problem Owner's "Release".
**Why.** Orphaned applications are where unpatched dependencies, forgotten data and undocumented network paths live.
**Verified by.** `test`: a scheduled ownership check opens the decommissioning process automatically.

### OWN-03: Citizen-developed applications have limits
**Rule.** Applications without a Technical Owner may be resilience class B or C, and may handle data up to *Confidential*. Class A applications, applications that handle *Taxpayer-Restricted* data, and applications exposed to the internet require a Technical Owner.
**Why.** Citizen development is encouraged at NATAX: the pipeline makes most governance automatic. But some failures are expensive enough that a professional team must be accountable, and on call, for the technical side.
**Verified by.** `test`: the pipeline compares `resilience.class`, `data[].classification` and `exposure` in `architecture.yaml` against the presence of `technical-owner`.

### OWN-04: Each application pins its architecture versions
**Rule.** `architecture.yaml` lists the versions of this central architecture, of the network and infrastructure architectures, and of its platform's architecture. Only versions that are *active* or *deprecated* are accepted (see [lifecycle](../governance/lifecycle.md)). A release that migrates an application off a decommissioned version pins the new version, and is judged against it.
**Why.** Architecture changes. An application must be judged against the rules it was built for, and migrations to new versions must be deliberate, visible and finite.
**Verified by.** `test`.

### OWN-05: The repository is the system of record
**Rule.** The application's repository holds its requirements, decisions, tests, reviews and release history, along with its code. Nothing needed to understand, change or operate the application lives only in someone's head, a chat log or a ticket system.
**Why.** Agents are replaceable workers, and so are people. A new Development Agent, or a new Problem Owner, must be able to start from the repository alone.
**Verified by.** `review`: the Governance Agent checks that each release candidate's changes are explained by requirements, decisions or tests in the repository.

### OWN-06: Decommissioning is a release
**Rule.** Retiring an application goes through the pipeline like any other change. Its network paths, workload identities, DNS records, load balancer configuration, monitoring and secrets are removed, and its data is deleted or archived according to its retention rules.
**Why.** Applications that are "switched off" but not removed leave network paths open and credentials valid.
**Verified by.** `test`: after decommissioning, the pipeline verifies that nothing in the network policy, load balancer configuration or identity system still refers to the application.

### OWN-07: Operational response matches resilience class
**Rule.** Who responds to an incident, and when, follows from the resilience class:

| Class | Platform incident | Application incident |
|---|---|---|
| A | Central IT, 24×7 | Technical Owner, 24×7 |
| B | Central IT, 24×7 | Problem Owner (or delegate) during business hours, with the Development Agent available to diagnose. Technical Owner if there is one. |
| C | Central IT, business hours | Problem Owner, best effort |

During the filing season (see [delivery](delivery.md)), class B applications that support filing are covered on extended hours: 07:00–23:00 headquarters time, seven days a week.
**Why.** A citizen developer can own an application without being paged at 3 a.m. The platform beneath it, which is shared, is always covered by professionals.
**Verified by.** `review`.

### OWN-08: Every application is in the landscape
**Rule.** Every application, whatever its platform, is registered in the [landscape](../landscape/landscape.md) at its first release candidate, as "in development": what it's for, who uses it, its Problem Owner, its platform and status. The pipeline registers it at intake, so a second team looking for the same thing finds it before either has built much, and keeps the entry in step with `architecture.yaml` on every release. Applications built outside the pipeline (a Power App shared from someone's own environment, a spreadsheet that became a system) are found by a weekly comparison of the platforms' own inventories with the landscape, and either registered, with a Problem Owner, or retired.
**Why.** The landscape is what the [look-before-you-build check](simplicity.md#sim-09-look-before-you-build) relies on, and what network policy, capacity and ownership checks are generated from. An application nobody knows about can't be reused, secured or retired.
**Verified by.** `test`: registration at the first release candidate; the weekly inventory comparison.
