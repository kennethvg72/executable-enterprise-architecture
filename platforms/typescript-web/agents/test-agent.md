# Test Agent: TypeScript web applications

This adds to the [central Test Agent role](../../../enterprise-architecture/agents/test-agent.md). Read that first.

## Your tools

- `node:test` and `node:assert/strict` ([TS-10](../standards.md#ts-10-tests-use-the-built-in-runner-a-real-database-and-real-http)).
- `test/helpers.ts`: `resetDatabase()` gives you a freshly migrated test database; `startTestApp()` starts the application on a random port with captured logs; `client().signInAs(role)` signs in through the real sign-in and handles cookies and CSRF tokens.
- Synthetic data generators in `test/`. Write generators, not fixtures copied from anywhere ([DAT-04](../../../enterprise-architecture/principles/data.md#dat-04-non-production-environments-use-synthetic-data-only)).
- Stub servers for other services, built with `node:http` in the test, so you control exactly how they fail: slow, down, wrong status, malformed body.

## For every feature, test at least

| What | How |
|---|---|
| Each requirement in `docs/requirements.md` | HTTP tests, named after the requirement ID |
| Every route as every role, as no role, and signed out | 200, 403 and redirect or 401, as intended ([IAM-04](../../../enterprise-architecture/principles/identity-and-access.md#iam-04-authorization-is-explicit-server-side-and-deny-by-default)) |
| Every POST without a CSRF token | 403 |
| Every input with empty, too long, wrong type, markup and SQL-looking values | 400, or stored and shown escaped, never executed ([SEC-06](../../../enterprise-architecture/principles/security.md#sec-06-all-input-is-hostile)) |
| Every `consumes` entry slow, down and returning nonsense | The application degrades as declared, and readiness reflects only critical dependencies ([RES-06](../../../enterprise-architecture/principles/resilience.md#res-06-healthy-means-ready-to-serve), [RES-07](../../../enterprise-architecture/principles/resilience.md#res-07-degrade-visibly-instead-of-failing-completely)) |
| Two users changing the same record at once | One wins and the other is told, clearly. No lost update. |
| Time: midnight, the change to and from daylight saving time, the filing deadline, year end | Grouping and display use the configured time zone ([TS-11](../standards.md#ts-11-time-is-stored-in-utc-and-shown-in-a-named-time-zone)) |
| Retention | Old data goes, recent data stays, audit records stay ([DAT-05](../../../enterprise-architecture/principles/data.md#dat-05-retention-is-defined-and-automated)) |
| Audit | Each audited action writes an audit record, and audit records can't be changed or deleted ([IAM-07](../../../enterprise-architecture/principles/identity-and-access.md#iam-07-every-action-on-sensitive-data-is-attributable)) |
| Logs captured during the tests | No session IDs, secrets, or values shaped like taxpayer identifiers ([OBS-01](../../../enterprise-architecture/principles/observability.md#obs-01-logs-are-structured-central-and-clean)) |

## When rebuilding an existing application

Read the old implementation for behavior, not code. Write tests for the behavior you find, and mark each one *confirmed* (the Problem Owner says it's intended) or *question* (it might be a bug). Bring the questions to the Problem Owner through the Development Agent. Don't carry the old bugs over.
