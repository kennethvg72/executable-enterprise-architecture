# Checks per domain

These are the checks the pipeline runs for each affected domain ([change-impact.md](change-impact.md)).

- **Deterministic** checks give the same answer every time and need no AI. They take into account the Board's exceptions ([exceptions.yaml](../governance/exceptions.yaml)) for the application. A failure that remains after that can't be overridden by anyone, the Governance Agent included.
- **Review** checks are judged by the Governance Agent against the cited rules.
- The **Here** column shows what this proof of concept implements. ✅ means implemented in this repository's tools; 📄 means the check is described, and a real pipeline would implement it with the named kind of tool. A check that didn't run is reported as skipped, never as passed.

## Always

### Eligibility gates

Evaluated at intake for every candidate, whatever the change. Each can restrict an application to releasing fixes only.

| Gate | Rules | Here |
|---|---|---|
| Problem Owner is an active employee (or Central IT acts as custodian) | OWN-01, OWN-02 | ✅ `validate-manifest.ts` |
| Pinned architecture versions are active or deprecated | OWN-04 | ✅ `validate-manifest.ts` |
| No overdue security findings | SEC-08 | 📄 finding tracker |
| Last backup restore test passed | DAT-08 | 📄 restore records |
| Class A and B in the datacenters: last site failover exercise passed and is under seven months old (not for Power Apps or Android apps, [RES-11](../principles/resilience.md#res-11-saas-platforms-and-devices)) | RES-09 | 📄 exercise records |
| From six weeks before the deadline: the planning-peak load test passed | RES-10 | 📄 load test records |
| Peak freeze respected | DEL-05 | ✅ date check in `pipeline.ts`; the Governance Agent judges whether a "fix" is a fix |
| Temporary complexity and exceptions haven't passed their end dates | SIM-07 | ✅ `validate-manifest.ts` |
| The application fits its platform's limits: resilience class, data classification, exposure, data stores | RES-11, platform standards | ✅ `validate-manifest.ts`, from the platform's `platform.yaml` |
| A landscape check is recorded: what already exists, who was asked, the outcome | SIM-09 | ✅ presence, `validate-manifest.ts`; the Governance Agent judges the outcome against [landscape.md](../landscape/landscape.md) |

### Checks

| Check | Rules | Kind | Here |
|---|---|---|---|
| Manifest is complete and valid | OWN-03, DAT-01, RES-01, IAM-01, OBS-04 | Deterministic | ✅ `enterprise-architecture/tools/validate-manifest.ts` |
| No secrets in the repository | SEC-03 | Deterministic | ✅ `enterprise-architecture/tools/scan-secrets.ts` (simple patterns; a real pipeline uses a dedicated scanner) |
| The application's tests pass, rerun by the pipeline | DEL-02 | Deterministic | ✅ runs the application's `npm test` |
| Dependencies have a recorded reason and are pinned | SIM-01, SIM-05, SEC-05 | Deterministic | ✅ `enterprise-architecture/tools/check-dependencies.ts` |
| Dependencies have no known reachable critical vulnerabilities | SEC-05, SEC-08 | Deterministic | 📄 vulnerability scanner against a mirror of advisories |
| Evidence is authentic: signed "Release", signed reviews | AGT-01, AGT-06 | Deterministic | 📄 signature verification; simulated here |
| Open local findings are listed in the candidate | AGT-02 | Deterministic + review | 📄 parse review files; the Governance Agent compares them by hand here |

## application

The platform's own checks, as listed in its `platform.yaml`, run in every candidate: for TypeScript, the type check and the tests against a real database; for Power Apps, the solution checker and the Playwright tests; for Android, the Gradle check and the tests on managed emulators. Where a platform's tools aren't available, the check is reported as skipped, never as passed.

| Check | Rules | Kind | Here |
|---|---|---|---|
| Design is the simplest that meets the requirements; no unexplained components | SIM-01..08 | Review | Governance Agent |
| Input validation, output encoding, parameterized queries | SEC-06 | Deterministic + review | 📄 static analysis; ✅ the Test Agent's injection tests run as part of the application's tests |
| Contract tests: against declared providers, and declared consumers' expectations against this provider | INT-03, INT-06 | Deterministic | 📄 run in test |

## data

| Check | Rules | Kind | Here |
|---|---|---|---|
| Migrations apply cleanly from an empty database | DAT-07 | Deterministic | ✅ the application's tests apply all migrations |
| Migrations upgrade the schema currently in production, with populated synthetic data, within time and locking limits; the previous release's tests pass against the new schema | DAT-07, DEL-03 | Deterministic | 📄 in acceptance |
| No taxpayer-restricted data outside systems of record; classification plausible | DAT-01, DAT-02 | Review + deterministic | Governance Agent; ✅ the Test Agent's pattern scan in the application's tests |
| Test fixtures come from a generator in the repository | DAT-04 | Deterministic | 📄 fixture provenance check |
| Grants are least privilege for the application's role; audit records can't be changed | SEC-09, IAM-07 | Deterministic | ✅ the application's tests check its own grants |

## network

| Check | Rules | Kind | Here |
|---|---|---|---|
| Policy compiles from intent; every path is declared by both consumer and provider | SEC-02, INT-01, INT-06 | Deterministic | ✅ `network/tools/compile.ts` |
| Policy invariants hold (internet only to the edge, admin only from PAWs, databases only via endpoints, test can't reach production, only the egress proxy reaches the internet, every DC1↔DC2 flow can transit HQ) | SEC-02, SEC-07, IAM-06, RES-04, RES-05, INT-05 | Deterministic | ✅ `network/tools/verify.ts` |
| The Test Agent's explicit network expectations hold | SEC-02 and others | Deterministic | ✅ `network/expectations.yaml` |
| Generated configuration matches the intent | DEL-04 | Deterministic | ✅ `network/tools/verify.ts` |
| Targeted probes for new and removed paths, in test and acceptance | SEC-02 | Deterministic | ✅ probe plan generated by `compile.ts`, run by `probe.ts`; 📄 executed from each vantage point in the environments |

## load-balancing

| Check | Rules | Kind | Here |
|---|---|---|---|
| Configuration renders from intent; every backend has a readiness check, not a TCP or TLS check | RES-06, SIM-04 | Deterministic | ✅ `infrastructure/tools/render.ts`, `infrastructure/tools/verify.ts` |
| Readiness fails when a critical dependency fails, and liveness doesn't | RES-06 | Deterministic | ✅ the application's own tests |
| Database endpoints route only to the current primary | RES-05 | Deterministic | ✅ `infrastructure/tools/verify.ts` |

## infrastructure

| Check | Rules | Kind | Here |
|---|---|---|---|
| Class A and B services serve from both datacenters; placement matches the manifest | RES-02 | Deterministic | ✅ `infrastructure/tools/verify.ts` |
| One datacenter can carry the planning peak of every class A and B service | RES-03, RES-10 | Deterministic | ✅ `infrastructure/tools/verify.ts` |
| Voting members use only in-band links, one per site, and HQ routes transit | RES-04 | Deterministic | ✅ `infrastructure/tools/verify.ts` |
| Database configuration: synchronous non-strict, watchdog, only the synchronous replica promotable | RES-05 | Deterministic | ✅ `infrastructure/tools/verify.ts` |

## identity

| Check | Rules | Kind | Here |
|---|---|---|---|
| One identity provider per application, matching its users and exposure | IAM-01 | Deterministic | ✅ `validate-manifest.ts` |
| Every endpoint authorized for every role, deny by default; records belong to their owner | IAM-04 | Deterministic | ✅ the application's own tests (Test Agent) |
| Workload certificates and mTLS configured | IAM-05 | Deterministic | 📄 configuration check |
| The Security Agent attacked it in acceptance, when [the impact requires](change-impact.md#the-security-agent); no open High or Critical findings | SEC-12, SEC-08 | Review | 📄 acceptance stage; the [Security Agent](../agents/security-agent.md) can be run here as a separate agent session against a local deployment |

## resilience

| Check | Rules | Kind | Here |
|---|---|---|---|
| Class matches the Problem Owner's statement | RES-01 | Review | Governance Agent |
| Every declared dependency's failure is tested | RES-07, INT-04 | Deterministic + review | ✅ the application's own tests; the Governance Agent checks each `consumes` entry has a failure test |
| Relevant failure scenarios pass in acceptance | RES-09 | Deterministic | 📄 [infrastructure failure catalog](../../infrastructure/failure-scenarios.md); ✅ the design-level simulation in `infrastructure/tools/simulate.ts` |

## operations

| Check | Rules | Kind | Here |
|---|---|---|---|
| `/health/live`, `/health/ready` and `/metrics` exist and behave | OBS-02, OBS-03 | Deterministic | ✅ the application's own tests |
| No secrets or taxpayer identifiers in logs | OBS-01 | Deterministic | ✅ the application's own tests (log capture) |
| Alerts have an owner and a runbook | OBS-04 | Deterministic | ✅ `validate-manifest.ts` |
| Rollback rehearsed and measured when the release includes a migration | DEL-03 | Deterministic | 📄 acceptance stage |
