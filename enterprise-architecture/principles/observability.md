# Observability (OBS)

If an application can't be observed, it can't be operated, and nobody knows whether it works. Observability is built in from the first release, not added after the first incident.

### OBS-01: Logs are structured, central and clean
**Rule.** Applications write logs as one JSON object per line to standard output, with at least `time` (ISO 8601, UTC), `level`, `msg`, `service` and `requestId`. The platform collects them centrally. Logs never contain secrets, session tokens or *Taxpayer-Restricted* data. Refer to records by opaque references.
**Why.** Plain-text logs are hard to search across services. Logs with taxpayer data in them turn the log platform into the most sensitive system NATAX has.
**Verified by.** `test`: the Test Agent scans logs captured during the test run for secrets and taxpayer identifier patterns. Any match fails the run.

### OBS-02: Metrics show what users feel
**Rule.** Every service exposes metrics in Prometheus text format at `/metrics` on port 9464, separate from the port that serves users, covering at least request rate, error rate and latency per endpoint, plus saturation of its bounded resources (connection pools, queues). The network policy lets only the observability platform reach port 9464.
**Why.** These are the signals that tell you a service is degrading before users report it. A separate port means the network, not the application, keeps them private.
**Verified by.** `test`: the pipeline checks the endpoint exists and exposes the required metric names.

### OBS-03: Health endpoints are mandatory
**Rule.** Every service implements `/health/live` and `/health/ready` as defined in [RES-06](resilience.md#res-06-healthy-means-ready-to-serve).
**Why.** Load balancers, the deployment process and the monitoring platform all depend on them.
**Verified by.** `test`.

### OBS-04: Every alert has an owner and a runbook
**Rule.** Alerts fire on symptoms users would notice (error rate, latency, readiness failing), not on every internal cause. Each alert names its owning role (per [OWN-07](ownership.md#own-07-operational-response-matches-resilience-class)) and links a runbook in the application's repository saying what to check and what to do.
**Why.** An alert nobody owns gets muted. An alert without a runbook gets escalated to whoever happens to be awake.
**Verified by.** `test`: the alert configuration is checked for owner and runbook.

### OBS-05: Requests can be followed across services
**Rule.** Services accept and propagate a W3C `traceparent` header and include its trace ID as `requestId` in logs. Class A services also export traces to the central tracing platform via OpenTelemetry.
**Why.** "The filing failed somewhere" isn't diagnosable. "The filing failed at the calc engine, after 4.8 seconds" is.
**Verified by.** `test`: the Test Agent sends a request with a known trace ID and checks it appears in the logs.

### OBS-06: Every deployment is verified, and rolled back if needed
**Rule.** After every production deployment step, the pipeline compares error rate, latency and readiness with the period before. If they degrade beyond the thresholds in the [pipeline](../pipeline/deployment.md#verification-and-automatic-rollback), it rolls back automatically.
**Why.** A deployment isn't done when the files are copied. It's done when the service is demonstrably still working.
**Verified by.** `test`: the pipeline.
