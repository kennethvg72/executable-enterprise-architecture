# Change impact

Not every release needs every check. A small UI change shouldn't trigger thousands of network probes. A one-line change to a connection pool setting, on the other hand, might need load testing. The pipeline works out what a change affects and requires the checks for those domains, plus a small set that always run.

The Governance Agent determines impact from the **actual diff** between the candidate's commit and the commit currently in production. The impact used is the **union** of three things: the candidate's `declared-impact`, the domains the trigger table below selects, and the Governance Agent's own assessment. Any difference between them is recorded in the verdict. An undeclared impact is itself a finding: the Development Agent misjudged the change.

For network and infrastructure, the pipeline also compares the candidate's `architecture.yaml` with the application's entry in the [landscape](../landscape/landscape.yaml), and lists every change: new or removed dependencies, interfaces, sites, capacity and resilience class. Everything the candidate asks for is checked, whether the application is new or already in production.

## Domains

These are the domains a release is judged in. Each maps to the checks in [checks.md](checks.md).

| Domain | Covers |
|---|---|
| **application** | Code quality, architecture compliance, tests, dependencies, security findings |
| **data** | Schema changes, data classification, grants, retention, integrity |
| **network** | Required paths, firewall policy, segmentation, prohibited connectivity |
| **load-balancing** | Frontends, health checks, routing, failure behavior |
| **infrastructure** | Capacity, placement across sites, configuration compliance |
| **identity** | Authentication, authorization, workload identity, privileged access, secrets |
| **resilience** | Redundancy, failover, recovery, dependency failure behavior |
| **operations** | Monitoring, logging, alerting, deployment verification, rollback readiness |

## What triggers what

| If the diff changes... | Affected domains |
|---|---|
| Any source code | application, operations |
| Dependency manifests or lockfiles | application (dependency checks, SIM-01) |
| Migration files, or SQL in code | data |
| `architecture.yaml` `consumes` or `provides` | network, load-balancing, resilience |
| `architecture.yaml` `runtime` (instances, capacity) | infrastructure, load-balancing |
| `architecture.yaml` `data` | data |
| `architecture.yaml` `users`, or authentication or authorization code | identity |
| `architecture.yaml` `resilience` | resilience, infrastructure |
| Health endpoint code, timeouts, pool sizes, retry logic | load-balancing, resilience |
| Logging, metrics, alert definitions, runbooks | operations |
| `architecture.yaml` architecture versions | every domain (the rules themselves changed) |
| Purpose `decommission` | every domain |

**Always**, regardless of the diff: the checks and eligibility gates under [Always](checks.md#always) in checks.md, and deployment verification.

## The Security Agent

The [Security Agent](../agents/security-agent.md) reviews the candidate ([SEC-12](../principles/security.md#sec-12-security-is-reviewed-by-someone-who-didnt-build-it)) when any of these is true:

- It is the application's first release.
- The impact includes **identity**, **data** or **network**.
- The application is exposed beyond NATAX's internal network (`internet` or `staff-edge`), or is class A, and the impact includes **application**.
- The change touches anything that parses input from outside NATAX: uploads, imports, messages from external systems.

Otherwise it doesn't, and the verdict says why.

## Judgment is still needed

The table is a floor. The Governance Agent adds domains when the diff warrants it. Examples:

- A change to an SQL query that turns an indexed lookup into a full table scan doesn't change a migration, but it affects **resilience** and **infrastructure** (capacity at peak).
- A new outbound HTTP call hidden in a library update is a **network** change, even though `consumes` didn't change. It's also a finding: the manifest is incomplete.
- A change to error handling around a dependency affects **resilience**, because it changes failure behavior.

The table is a floor: a domain it selects can't be dropped, by the Governance Agent or anyone. An agent can be persuaded; a floor can't. A change that only fixes a comment still gets the operations checks; that costs minutes, and a persuasive diff description that switches off checks costs far more ([AGT-09](../principles/ai-agents.md#agt-09-content-is-data-not-instructions)).

## Shared infrastructure changes

Changes to shared infrastructure (a load balancer, the PostgreSQL cluster, the network itself) are release candidates of their own, owned by Central IT. Their impact is every application that depends on them, so they trigger the checks for each of those applications' affected domains, and a full network probe regression.
