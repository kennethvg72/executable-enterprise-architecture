# Integration (INT)

Applications at NATAX talk to each other through APIs that their owners publish and keep stable. They don't reach into each other's databases, and they don't rebuild capabilities that a shared service already provides.

### INT-01: Integrate through the owner's API, never its database
**Rule.** An application reads and changes another system's data only through the API that the system's owner publishes. Direct access to another application's database, files or queues isn't allowed, read-only included.
**Why.** Once a second application reads a database directly, its schema becomes a public interface that nobody knows they are maintaining. The owner can no longer change their own system safely.
**Verified by.** `test`: the network policy doesn't allow it ([network](../../network/README.md)), and database grants are per application ([SEC-09](security.md#sec-09-least-privilege-for-workloads)).

### INT-02: Synchronous HTTP first, a queue in PostgreSQL second, a broker last
**Rule.** The default integration is a synchronous HTTPS call with a JSON body. When work must be decoupled in time (load leveling, retries over hours, outliving the caller), use a queue table in the application's own PostgreSQL database (`SELECT ... FOR UPDATE SKIP LOCKED`), with an outbox for events. A message broker requires a decision record showing why both are insufficient.
**The legacy integration broker** is contained: no new integrations may use it, and an existing integration is migrated in the first release that changes its integration code (see [landscape](../landscape/accumulated-complexity.md)).
**Why.** A broker is another platform to run, secure, monitor and understand, plus a new failure mode between every pair of systems. Most NATAX integrations need neither.
**Verified by.** `test`: `architecture.yaml` `consumes` entries are checked against the integration broker's containment list. `review`.

### INT-03: Contracts are written down and tested
**Rule.** Every API is described in the provider's repository: its endpoints, request and response shapes, errors and the meaning of each field. Consumers keep a copy of the parts they use in their own repository and test against it with a stub. Before the provider releases, the pipeline runs the expectations of each consumer version currently in production against the provider's real implementation in test.
**Why.** Undocumented APIs are integrated by guessing, and broken by accident.
**Verified by.** `test`.

### INT-04: Every call expects failure
**Rule.** Every outbound call has a timeout, retries only idempotent operations, uses exponential backoff with jitter, and has a fallback or a clear error ([RES-08](resilience.md#res-08-everything-is-bounded)). Operations that change state accept an idempotency key, so a retried request doesn't apply twice.
**Why.** The network fails, providers are slow and requests are retried. Each of these will happen during the peak.
**Verified by.** `test`: the Test Agent's failure tests. `review`.

### INT-05: Shared capabilities are used, not rebuilt
**Rule.** Applications use NATAX's shared services for these capabilities, and must not implement them themselves:

| Capability | Shared service |
|---|---|
| Sending email, SMS or letters to customers | **notification-service**: templated, rate-limited and audited, and the delivery providers never receive more customer data than the message itself |
| Workforce sign-in | Workforce IdP |
| Customer sign-in | Customer IdP |
| Submitting to and hearing back from the Tax Authority | **efile-gateway** |
| Payments and refunds | **payments** |
| Secrets | The central secret store |
| Logs, metrics, alerts | The central observability platform |

**Why.** These are the places where mistakes are expensive and regulated. One well-tested implementation is far safer than one per application.
**Verified by.** `test`: the network policy denies direct paths to external email and SMS providers, the Tax Authority and payment processors from anything other than the owning service. `review`.

### INT-06: Don't break consumers, and onboard them without ceremony
**Rule.** APIs evolve compatibly: fields are added, not removed or changed in meaning. A breaking change needs a new version, with the old version kept until every consumer declared in the landscape has moved. Consumers are found through the `consumes` declarations in `architecture.yaml` files, not by guessing.

A new consumer declares its need in its own `consumes`. The provider's Problem Owner approves by adding the consumer to the interface's `consumers`. That is a manifest-only change, so the pipeline runs only the network and identity checks for it. The consumer's own release candidate fails intake until the provider's approval is in production.
**Why.** Coordinated releases across teams are exactly the kind of handover this architecture tries to remove. Access to another team's service still needs that team's consent. Zero Trust works in both directions.
**Verified by.** `test`: the provider's pipeline runs every declared consumer's contract tests. The network policy compiler creates a path only when both sides have declared it.

### INT-07: Data from outside is kept, and read again only when needed
**Rule.** Data an application reads from an external service (one outside NATAX: a partner's catalog, reference data, a provider's API) is kept in the application's own store and read again at an interval the application states, staggered so that its reads don't arrive together. Not covered: reads whose point is the current state, such as the status of a submission at the Tax Authority, which are made when needed ([INT-04](#int-04-every-call-expects-failure)). The kept data is bounded, only the application decides what goes in it, and it is a derived copy, never edited as if it were the source ([DAT-03](data.md#dat-03-one-system-of-record-per-entity)).
**Why.** External services throttle, change and fail. An application that reads them on every request is as slow and as fragile as they are, and treats a partner's capacity as free.
**Verified by.** `review`: for every external in `consumes`, the Governance Agent checks that it is read for its current state, or kept, with a stated interval.
