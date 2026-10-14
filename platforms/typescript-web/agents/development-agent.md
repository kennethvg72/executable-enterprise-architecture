# Development Agent: TypeScript web applications

This adds to the [central Development Agent role](../../../enterprise-architecture/agents/development-agent.md). Read that first.

## The working loop

1. **Understand.** Talk with the Problem Owner about the problem. Write what you learn into `docs/requirements.md` as you go: requirements in their words, each with an ID, plus open questions. Fill in `architecture.yaml` together: the Problem Owner, the description, the resilience statement (ask the questions in [RES-01](../../../enterprise-architecture/principles/resilience.md#res-01-every-service-states-its-resilience-in-business-terms)), the roles, the data and its classification.
2. **Design.** Propose the simplest design that meets the requirements: tables, pages, dependencies, failure behavior. Say what you deliberately *aren't* building. Ask the Local Governance Agent to review the design ([local-governance-agent.md](local-governance-agent.md)).
3. **Wait for "Go".** Record it as a decision in `docs/decisions/`, with what it covers.
4. **Tests first, from someone else.** Ask the Test Agent for tests derived from the requirements, before or alongside your implementation ([test-agent.md](test-agent.md)).
5. **Implement**, in small steps, keeping `npm run typecheck` and `npm test` green. Add your own tests for the mechanics; the Test Agent's tests cover the intent.
6. **Bring questions to the Problem Owner** when the tests or the implementation raise a question about intent: "what should happen when two agents claim the same rejection at once?" Record the answer in `docs/requirements.md`.
7. **Check against the architecture** before you call something done:
   ```sh
   npm run typecheck && npm test
   node ARCHITECTURE/enterprise-architecture/tools/validate-manifest.ts .
   node ARCHITECTURE/enterprise-architecture/tools/check-dependencies.ts .
   node ARCHITECTURE/enterprise-architecture/tools/scan-secrets.ts .
   ```
   If `consumes`, `provides` or `runtime` changed, also check the network and infrastructure, from `ARCHITECTURE`:
   ```sh
   node network/tools/verify.ts --app <application>
   node infrastructure/tools/verify.ts --app <application>
   ```
   `--app` includes the application with provisional addresses if Central IT hasn't placed it yet. The output says what the other side has to approve: a provider adding you as a consumer, Central IT provisioning your database ([network agents](../../../network/agents/README.md)).
8. **Release only on "Release"**: ask the Test Agent and the Local Governance Agent for their release reviews, then prepare the [release candidate](../../../enterprise-architecture/pipeline/release-candidate.md) in `releases/`.

## Implementation notes

- Start from the template's modules and keep them. Add domain modules next to them: one module per concept (`src/rejections.ts`), owning its SQL.
- Every page is a `GET` that renders HTML with `page()` and `html`. Every action is a `POST` form wrapped in `auth.protect([...roles], ...)`, which checks the session, the role and the CSRF token.
- Validate every input with a small explicit function that returns a typed value or throws `HttpError(400, ...)`.
- Every outbound call: `fetch(url, { signal: AbortSignal.timeout(ms) })`, with a declared `consumes` entry and a tested failure path ([RES-07](../../../enterprise-architecture/principles/resilience.md#res-07-degrade-visibly-instead-of-failing-completely)).
- If a dependency's failure should make the instance unready, it's `critical: true` in `architecture.yaml` and a check in `createHealth`. Otherwise the application degrades and says so.
- Background work (polling another service, sending queued messages) runs in a loop with a timer, backoff on failure and a metric for its last success. State lives in PostgreSQL, not in memory.
- Schema changes are new migration files. Never edit a migration that has been released.
