# Runbook: ReadinessFailing

**What it means.** An instance answers `/health/ready` with 503: it can't reach a critical dependency (see `consumes` with `critical: true` in architecture.yaml). The load balancer has stopped sending it traffic. If all instances fail, users get an error page.

**Check.**
1. The readiness response names the failing check: `curl -s https://<instance>:8443/health/ready`.
2. If `database` fails: the instance can't reach the database at all. Is the database cluster healthy? Did a network change cut this instance off? Central IT owns both; the platform incident process covers them.
3. If only one instance fails, the others are carrying the load. Restarting it is safe.

Overload doesn't show up here: a busy instance stays ready, and answers excess requests with 503 "Busy" (watch `db_pool_waiting` and the 503 rate instead).

**Do.** Platform problem: Central IT handles it. Application problem (a bad release, a connection setting): ask the Development Agent to diagnose from the logs and metrics. If it started with a release, the pipeline can roll back.
