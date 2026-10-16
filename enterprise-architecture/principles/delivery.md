# Delivery and change (DEL)

Every change to production goes through one door. That door is fast, automatic and safe. It has to be, because it's the only one.

Small, frequent releases are the norm. The pipeline is designed for many releases a day across the landscape, because small changes are easy to verify and easy to undo.

## Environments

| Environment | Where | Data | Who changes it |
|---|---|---|---|
| **Development** | The Problem Owner's or developer's machine | Synthetic | The Development Agent, freely |
| **Test** | DC1 and DC2, on production's idle capacity | Synthetic | The pipeline, on every release candidate |
| **Acceptance** | DC1 and DC2, on production's idle capacity | Synthetic | The pipeline, after test passes |
| **Production** | DC1 and DC2, active/active | Real | The pipeline only ([SEC-01](security.md#sec-01-only-the-central-pipeline-changes-production)) |

Test and acceptance are isolated from production ([SEC-07](security.md#sec-07-test-environments-cant-reach-production)). They run at lower priority on capacity that production reserves for losing a datacenter, so they are the first to slow down when that happens ([RES-03](resilience.md#res-03-one-datacenter-carries-the-whole-peak)).

## The filing calendar

The Tax Authority's filing deadline is **April 30**. The **filing season** runs from February 1 to May 15. The **peak freeze** runs from April 16 to May 3.

### DEL-01: Every change is a release candidate with evidence
**Rule.** A change reaches production only as a [release candidate](../pipeline/release-candidate.md): a specific commit, the artifacts built from it (identified by digest), and the evidence that it is ready. The same artifact is promoted from test to acceptance to production. Nothing is rebuilt between environments.
**Why.** If the artifact in production isn't the one that was tested, nothing was tested.
**Verified by.** `test`: the pipeline compares artifact digests across environments.

### DEL-02: Tests are part of the change
**Rule.** Every change includes the automated tests that show it works, written or reviewed by the Test Agent. Requirements are recorded as tests wherever they can be. A change that reduces test coverage of existing behavior needs a reason.
**Why.** At NATAX, nobody reviews code line by line. Tests, written independently of the implementation, are how intent is checked.
**Verified by.** `test`: the pipeline runs them. `review`: the Governance Agent compares the change with its tests.

### DEL-03: Every release can be rolled back in minutes
**Rule.** The pipeline can restore the previous release of any application within 10 minutes, without restoring data. Rollback is its own procedure ([deployment.md](../pipeline/deployment.md#rollback)), not a slow re-run of the deployment. It requires backward-compatible schema changes ([DAT-07](data.md#dat-07-schema-changes-are-versioned-and-backward-compatible)) and keeping the previous artifact.
**Why.** Fast rollback is what makes frequent, small releases safe.
**Verified by.** `test`: the pipeline rehearses rollback in acceptance for every release that includes a schema migration, and measures it.

### DEL-04: Infrastructure and network are code
**Rule.** Load balancer configuration, firewall policy, database configuration and server configuration are generated from versioned sources (the [landscape](../landscape/), each application's `architecture.yaml`, and the network, infrastructure and platform architectures) and deployed by the pipeline. Manual changes in production are incidents. Drift between the sources and what's running is detected daily and reverted.
**Why.** A configuration that only exists on the device can't be reviewed, tested or rebuilt.
**Verified by.** `test`: daily drift detection, and a check that generated configuration in the repository matches its sources.

### DEL-05: The peak freeze protects the deadline
**Rule.** During the peak freeze (April 16 to May 3), class A and B services release only fixes for production incidents and security findings rated *High* or *Critical*. The Governance Agent applies this automatically, based on the release candidate's declared purpose and its actual diff. Class C services are not frozen.
**Why.** The days around the deadline are the worst time to learn something new about a change.
**Verified by.** `test`: the pipeline checks dates and resilience class. `review`: the Governance Agent checks that a "fix" is really a fix.

### DEL-06: Checks verify the output, not the intent that produced it
**Rule.** A check reads what was actually produced (the generated firewall rules, the load balancer and database configuration, the deployed artifact) and compares it with the intent, never asking the code that produced it. A check that asks the generator "what did you mean to do?" proves only that the generator agrees with itself. There are two tiers:
- The **authority** runs the real software, in the version production runs (each architecture's `runtime-versions.yaml`), and observes behavior. nftables is loaded in a network namespace and probed. HAProxy is started against stub backends and read through its stats socket. Patroni's settings are read back from the running cluster. A syntax check (`nft -c`, `haproxy -c`) proves the configuration loads, not what it does.
- **Readers** read the generated text quickly, for early signal. Each reader's grammar is an explicit allowlist of what the renderer produces, so any statement outside it, valid or not, is refused. A reader may only fail early. A reader's pass without the authority is incomplete, never a pass. Every result records which tier produced it.

Every checker ships with the mutations it must catch: deliberately broken output (a dropped rule, `ct state new accept`, `verify none`, a watchdog turned off). Those mutations are the readable specification where "who checks the checkers" ends.
**Why.** Different models have different blind spots ([AGT-03](ai-agents.md#agt-03-use-different-models-for-independence)), and so does deterministic code: a renderer and a verifier built on the same structures fail together. When a renderer bug passes every check, the checks were testing the renderer's intentions, not the configuration that will run.
**Verified by.** `test`: the readers ([nft.ts](../../network/tools/nft.ts), [check-output.ts](../../infrastructure/tools/check-output.ts)) and the authorities ([network](../../network/tools/authority.ts), [infrastructure](../../infrastructure/tools/authority.ts), [Patroni](../../infrastructure/tools/check-patroni-config.ts)) run in every pipeline; their mutation tests run with every change to the tools. Where an authority can't run (no Linux, or the wrong version), the result is INCOMPLETE. `review`: a new checker comes with its mutation tests.
