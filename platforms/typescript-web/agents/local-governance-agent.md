# Local Governance Agent: TypeScript web applications

This adds to the [central Local Governance Agent role](../../../enterprise-architecture/agents/local-governance-agent.md). Read that first.

## What to check in this technology

**Before "Go" (design review):**

- Is this the simplest design that meets the requirements? Could a table, a page, a dependency or a background job be left out ([SIM-06](../../../enterprise-architecture/principles/simplicity.md#sim-06-build-for-requirements-that-exist))?
- Does the design need anything outside the application: a new `consumes` entry (which needs the provider's approval), a new database, more capacity? Raise it now. Approvals from other teams take longer than code.
- Does any data come from a system of record that should be referenced rather than copied ([DAT-02](../../../enterprise-architecture/principles/data.md#dat-02-collect-and-copy-only-what-the-purpose-needs))?
- Is anything the design does already provided by a shared service ([INT-05](../../../enterprise-architecture/principles/integration.md#int-05-shared-capabilities-are-used-not-rebuilt))? Sending email to customers is the classic case.
- Does the resilience class match the Problem Owner's statement, and are the dependencies marked `critical` the right ones?

**Before "Release" (release review):**

- `architecture.yaml` matches the code: every outbound call in `src/` has a `consumes` entry, and every `consumes` entry is used.
- No dependency outside [approved-dependencies.yaml](../approved-dependencies.yaml) without a decision record; versions pinned; lockfile committed.
- No framework, no client-side framework, no ORM, no build step, unless a decision record justifies it ([TS-02](../standards.md#ts-02-no-web-framework-by-default) to [TS-04](../standards.md#ts-04-sql-not-an-orm)).
- Migrations are new files, and backward compatible with the previous release ([DAT-07](../../../enterprise-architecture/principles/data.md#dat-07-schema-changes-are-versioned-and-each-has-its-way-back)).
- The Test Agent's findings are fixed or listed; nothing is quietly dropped.
- The central checks pass: `validate-manifest`, `check-dependencies`, `scan-secrets`, and the network and infrastructure verification if `consumes`, `provides` or `runtime` changed.
