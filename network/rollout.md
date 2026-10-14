# Rolling out Zero Trust in an existing landscape

Nobody starts with a clean landscape. NATAX started with a flat network, two jump hosts, and hundreds of undocumented dependencies. This is how it got from there to default deny without breaking the filing season.

The order matters: **observe, declare, decide, monitor, enforce**, one group of services at a time.

## 1. Observe

Collect flow logs from every host for at least two weeks, including a month-end and, ideally, part of the filing season. Some dependencies only show up once a month, or once a year.

## 2. Declare

For each service, an agent proposes `consumes` and `provides` declarations from three sources: the service's configuration, its code, and the observed flows. A human confirms each one. The agent's job is to make declaring cheap; the owners' job is to decide what's legitimate.

## 3. Decide

Run [analyze-flows.ts](tools/analyze-flows.ts). It sorts what it observes ([ZTN-04](standards.md#ztn-04-observed-traffic-is-evidence-not-permission)):

- **Forbidden:** the architecture doesn't allow it, however useful it is to someone. For example, a report querying another application's database directly ([INT-01](../enterprise-architecture/principles/integration.md#int-01-integrate-through-the-owners-api-never-its-database)), or a laptop connecting straight to a database node. The report gives the rule and the compliant path forward. If the need is real and urgent, the owner moves it to the right interface by an agreed date, under a time-boxed Board exception until then ([escalation](../enterprise-architecture/governance/escalation.md#exceptions)).
- **Undeclared:** a question for the owners of both ends. Needed and legitimate: declare it, on both sides. Not needed: leave it undeclared, and it will be blocked.
- **Unknown address:** find out what it is before anything else. An inventory gap is a security gap.

The [sample report](observed/flowlog-sample-report.md) shows all three, and [findings.md](findings.md) records what was decided.

## 4. Monitor

Deploy the generated rulesets in **log-only** mode: the chains' policy set to accept, so packets that would be dropped are only logged. Run for at least a week. Every logged packet is either an undeclared dependency (go back to step 3) or something that should be blocked.

## 5. Enforce

Switch the chains' policy to drop. Run the full probe plan from every vantage point. Keep the rollback (back to log-only) ready for the first week.

## Order of rollout

1. **Test and acceptance first.** They must never reach production ([SEC-07](../enterprise-architecture/principles/security.md#sec-07-test-environments-cant-reach-production)), and enforcing that has the smallest blast radius.
2. **Administrative access**: port 22 only from PAWs. This is what made it possible to decommission the jump hosts.
3. **Databases**: only from the load balancer endpoints and their own peers.
4. **Egress**: everything to the internet goes through the proxy.
5. **Everything else**, one group of related services at a time, never during the peak freeze ([DEL-05](../enterprise-architecture/principles/delivery.md#del-05-the-peak-freeze-protects-the-deadline)).
