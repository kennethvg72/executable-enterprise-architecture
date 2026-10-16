# TypeScript web application standards (TS)

How NATAX builds web applications in TypeScript. These rules implement the [central principles](../../enterprise-architecture/README.md) for this technology. They add to them, and never relax them.

The theme is the same as everywhere else in the architecture: the platform already does most of what a web application needs. Node.js has an HTTP server, a test runner, `fetch`, cryptography and TypeScript support built in. Browsers have forms, validation, `fetch` and modules. PostgreSQL has transactions, constraints, JSON, full-text search and queues. Start there.

### TS-01: Node.js LTS and strict TypeScript, without a build step
**Rule.** Applications run on the Node.js active LTS release (24 at the time of writing). Node runs TypeScript directly, by removing the types, so there is no build step, no bundler and no transpiler. Code uses only erasable TypeScript syntax (`erasableSyntaxOnly`): no enums, namespaces or parameter properties. `tsc --noEmit` type-checks with `strict` enabled, and type errors fail the build.
**Why.** A build step is a moving part that has to be configured, cached, debugged and kept consistent between development and production. Node.js no longer needs one for server code.
**Verified by.** `test`: `npm run typecheck` in the pipeline.

### TS-02: No web framework by default
**Rule.** Applications use `node:http` with a small router (the template's whole HTTP layer, router included, is about 200 lines), not a web framework. Adopting a framework requires a decision record showing what the application needs that the standard library and the template don't provide.
**Why.** For internal applications, a framework mostly adds an API to learn, a dependency tree to patch and an upgrade path to follow. What it would provide (routing, parsing, cookies) is a few hundred lines that an agent writes and tests in minutes, and that NATAX then fully understands.
**Verified by.** `test`: [check-dependencies.ts](../../enterprise-architecture/tools/check-dependencies.ts) against [approved-dependencies.yaml](approved-dependencies.yaml).

### TS-03: HTML is rendered on the server
**Rule.** Pages are HTML rendered on the server, with forms for actions. Client-side JavaScript is used only where it clearly improves the task, as small native ES modules served by the application. No client-side framework, no single-page application, no bundler. The Content Security Policy forbids inline scripts.
**Why.** Most internal applications are lists, details and forms. Browsers have handled those well for thirty years. A client-side framework doubles the code, splits validation and authorization across two places, and gives a single-page application an attack surface the server can't see.
**Verified by.** `review`; `test`: the Test Agent checks the Content Security Policy header.

### TS-04: SQL, not an ORM
**Rule.** Applications use PostgreSQL ([DAT-06](../../enterprise-architecture/principles/data.md#dat-06-postgresql-is-the-database)) through the `pg` driver, with plain, parameterized SQL in the module that owns each table. Schema changes are numbered SQL files in `migrations/`, applied in order by the template's migration runner, and backward compatible across one release ([DAT-07](../../enterprise-architecture/principles/data.md#dat-07-schema-changes-are-versioned-and-backward-compatible)). Constraints (foreign keys, checks, unique) live in the database. Migrations run as the database's owner role; the application runs as its own runtime role (`<database>_app`), with grants for exactly what it does, set in a migration ([SEC-09](../../enterprise-architecture/principles/security.md#sec-09-least-privilege-for-workloads)). Its tests run as that role too.
**Why.** SQL is the interface PostgreSQL actually has. An ORM hides it behind another language, and makes the queries agents and humans need to reason about (locks, indexes, plans) harder to see.
**Verified by.** `test`: dependency check. `review`.

### TS-05: Approved dependencies only, pinned
**Rule.** The approved dependencies are listed in [approved-dependencies.yaml](approved-dependencies.yaml). Anything else needs a decision record whose "Dependencies" section names it ([SIM-01](../../enterprise-architecture/principles/simplicity.md#sim-01-every-component-must-earn-its-place)). Versions are exact, and `package-lock.json` is committed.
**Why.** Every dependency is code NATAX runs but didn't write.
**Verified by.** `test`.

### TS-06: Configuration from the environment, validated at startup
**Rule.** Configuration comes from environment variables, parsed and validated in one module (`src/config.ts`) at startup. Invalid configuration stops the application with a clear message. Secrets are read from files whose paths are given in the environment (the secret store mounts them), never from values in committed files. Secrets and workload certificates are read at startup. When the platform renews them, it restarts instances one at a time, each waiting for the previous one to be ready again, so rotation never needs code in the application and never takes the service down. Development defaults that would be unsafe in production (plain HTTP, the development sign-in) are refused unless `NODE_ENV=development` and the server listens on localhost only.
**Why.** An application that starts with a bad configuration fails later, in a more confusing way. Unsafe conveniences must not be one forgotten variable away from production.
**Verified by.** `test`: the Test Agent tests that unsafe combinations are refused.

### TS-07: Secure by default over HTTP
**Rule.** In production, applications serve HTTPS with their workload certificate ([IAM-05](../../enterprise-architecture/principles/identity-and-access.md#iam-05-every-workload-has-its-own-identity)). Every response carries a strict Content Security Policy, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` and `frame-ancestors 'none'`. Session cookies follow [IAM-02](../../enterprise-architecture/principles/identity-and-access.md#iam-02-applications-dont-handle-passwords). Every state-changing request is a POST carrying a per-session CSRF token. A staff API at the edge (`staff-edge`, for NATAX-managed devices, [AND-05](../android/standards.md#and-05-the-app-talks-only-to-natax-apis-by-identity-not-by-network)) takes no cookies: every call carries the workforce IdP's access token, which the template's `protectApi` checks for signature, issuer, its own audience, expiry (with seconds of tolerance, not minutes) and an approved client application (`OIDC_API_CLIENTS`), and takes the roles from. Sign-in only ever returns to a path on the application itself, judged after normalization. Request bodies are size-limited. Every input is validated by explicit functions at the boundary, and all output is HTML-escaped by the template's `html` tag.
**Why.** These are the defaults that stop the common attacks. Making them part of the template means nobody has to remember them.
**Verified by.** `test`: the Test Agent's security tests.

### TS-08: Health, metrics and logs come with the template
**Rule.** Applications keep the template's `/health/live`, `/health/ready` ([RES-06](../../enterprise-architecture/principles/resilience.md#res-06-healthy-means-ready-to-serve)), `/metrics` on port 9464 ([OBS-02](../../enterprise-architecture/principles/observability.md#obs-02-metrics-show-what-users-feel)) and JSON logging with a request ID taken from `traceparent` ([OBS-01](../../enterprise-architecture/principles/observability.md#obs-01-logs-are-structured-central-and-clean), [OBS-05](../../enterprise-architecture/principles/observability.md#obs-05-requests-can-be-followed-across-services)). Readiness checks exactly the dependencies marked `critical: true` in `architecture.yaml`.
**Why.** Operability is designed in, not added after the first incident.
**Verified by.** `test`.

### TS-09: Everything is bounded
**Rule.** The database pool has a maximum size and a connection timeout. Every outbound `fetch` has a timeout (`AbortSignal.timeout`). The server limits concurrent requests and answers 503 with `Retry-After` beyond that ([RES-08](../../enterprise-architecture/principles/resilience.md#res-08-everything-is-bounded)). Background work runs in loops with backoff, never in unbounded queues in memory.
**Why.** See RES-08. On deadline day, these limits decide whether a slowdown turns into an outage.
**Verified by.** `test`: overload and timeout tests.

### TS-10: Tests use the built-in runner, a real database, and real HTTP
**Rule.** Tests use `node:test` and `node:assert`, and come in three kinds:

1. **Unit tests** for pure logic.
2. **Database tests** against a real PostgreSQL test database (never a mock, never production data), with synthetic data from generators in `test/`.
3. **HTTP tests** that start the application in-process on a random port and send real requests, including as each role and as nobody.

A missing test database is a failure, not a reason to skip tests silently. The Test Agent writes and owns the tests ([DEL-02](../../enterprise-architecture/principles/delivery.md#del-02-tests-are-part-of-the-change)).
**Why.** Mocks test what the developer believed; real dependencies test what happens. PostgreSQL starts in a second, so there's no reason not to use it.
**Verified by.** `test`.

### TS-11: Time is stored in UTC and shown in a named time zone
**Rule.** Timestamps are stored as `timestamptz` and handled in UTC. Displaying them, and grouping them by day, uses an explicitly configured IANA time zone, in SQL (`AT TIME ZONE`) or with `Intl.DateTimeFormat`, never the server's local zone. Tests cover days with a daylight-saving change.
**Why.** "Which day did this happen?" has a different answer in every time zone, and twice a year a day has 23 or 25 hours.
**Verified by.** `test`.

### TS-12: The repository explains itself
**Rule.** Every application repository has the template's layout:

| Path | What |
|---|---|
| `AGENTS.md` | Instructions for any agent working on it, pointing to the role files. `CLAUDE.md` imports it. |
| `architecture.yaml` | What the application is, who owns it, what it needs ([template](../../enterprise-architecture/templates/architecture.yaml)). |
| `docs/requirements.md` | The requirements as they evolve, in the Problem Owner's words, with open questions. |
| `docs/decisions/` | Decision records, numbered, including where "Go" was given. |
| `docs/reviews/` | Test Agent and Local Governance Agent reviews. |
| `docs/runbooks/` | One per alert. |
| `docs/escalations/` | Escalations to the Architecture Board. |
| `docs/environment.md` | What bootstrap found and installed. |
| `releases/` | Release candidates, verdicts and deployment records. |

**Why.** The repository is the system of record ([OWN-05](../../enterprise-architecture/principles/ownership.md#own-05-the-repository-is-the-system-of-record)). A new agent, or a new Problem Owner, starts by reading it.
**Verified by.** `review`.

### TS-13: Develop on Linux, against the same PostgreSQL major version as production
**Rule.** Development happens on Linux: natively, in WSL 2 on Windows, or on macOS with the same tools from Homebrew. The local PostgreSQL has the same major version as production (18), listens on localhost only, and holds only synthetic data. Coding agents run sandboxed, with write access limited to the workspace ([SEC-11](../../enterprise-architecture/principles/security.md#sec-11-contain-the-tools-including-the-ai-ones)).
**Why.** "Works on my machine" is a difference between machines. Keeping the differences small keeps the surprises small.
**Verified by.** `review`: [BOOTSTRAP.md](BOOTSTRAP.md) checks and records it in `docs/environment.md`.
