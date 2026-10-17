# Anti-patterns: TypeScript web applications

Recognizable ways of breaking the [TypeScript standards](standards.md), with the way out. They add to the [central catalog](../../enterprise-architecture/anti-patterns.md), and work the same way: examples, not the boundary; every entry breaks a rule; each has a sample candidate in the [regression set](../../enterprise-architecture/pipeline/regression/README.md).

### AP-TS-01: Trusting markup from outside
**Looks like.** HTML built by string concatenation, a `raw()` around something that came from a user or a database, or an object with a "safe" property treated as safe markup.
**Why it hurts.** One unescaped value is a cross-site scripting hole in every page that shows it.
**Breaks.** [TS-07](standards.md#ts-07-secure-by-default-over-http).
**Instead.** The template's `html` tag for everything; `raw()` only for constant markup in the code, with a reason.

### AP-TS-02: Tests with the master key
**Looks like.** Tests that run as a database superuser or as the schema owner, while production runs as the least-privileged runtime role.
**Why it hurts.** A superuser passes every permission check, so a missing grant, or one that is too wide, never fails a test. It fails in production.
**Breaks.** [TS-10](standards.md#ts-10-tests-use-the-built-in-runner-a-real-database-and-real-http), [SEC-09](../../enterprise-architecture/principles/security.md#sec-09-least-privilege-for-workloads).
**Instead.** Tests run the application as its runtime role, against migrations applied by the owner role, and nothing runs as a superuser.

### AP-TS-03: The migration that breaks the running version
**Looks like.** A migration that renames or drops a column, or adds a required one, in the same release as the code that stops or starts using it.
**Why it hurts.** During a rolling deployment the old version runs on the new schema, and a rollback runs it there for good: it fails, and rollback stops being an option.
**Breaks.** [DAT-07](../../enterprise-architecture/principles/data.md#dat-07-schema-changes-are-versioned-and-backward-compatible).
**Instead.** Expand, then contract: add first, switch the code, remove in a later release.
