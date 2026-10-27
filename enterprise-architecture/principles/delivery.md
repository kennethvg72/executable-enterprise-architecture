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

### DEL-03: Every release can be rolled back to a known-good state
**Rule.** Every release can be returned to the known-good state before it, its data included, by executing its plan's rollbacks ([DEL-09](#del-09-every-release-has-a-deployment-plan-and-every-step-a-rollback)). Rollback is its own procedure ([deployment.md](../pipeline/deployment.md#rollback)), not a slow re-run of the deployment. A rollback that restores no data restores service within 10 minutes. One that restores data takes as long as a careful restore needs. During the verification window, the pipeline rolls back by itself, at once ([OBS-06](observability.md#obs-06-every-deployment-is-verified-and-rolled-back-if-needed)). After the window, a rollback runs only with the Architecture Board's approval. Nobody rehearses a rollback: the Central Agents judge it, from the plan.
**Why.** The Board: "Rollback means going back to a known-good-working-state. That includes data. Why? To minimize downtime." A restore is allowed to take longer, because "it is an event that should not happen regularly, as it means a development failure. In that case, it is acceptable that the downtime is a bit longer. A rushed restore often means more risk." After the window, a rollback throws away real work done since the release, so someone has to decide that it's worth it. And on rehearsals: "The Central Agents judge the deployment/rollback, they don't rehearse. If that seems to break for an application, then we will cross that bridge when we get there."
**Verified by.** `test`: [check-deployment.ts](../tools/check-deployment.ts) checks that every step that changes production is covered by exactly one rollback, which undoes it. `review`: the Governance Agent judges whether the rollbacks restore the known-good state, data included, and how long they take.

### DEL-04: Infrastructure and network are code
**Rule.** Load balancer configuration, firewall policy, database configuration and server configuration are generated from versioned sources (the [landscape](../landscape/), each application's `architecture.yaml`, and the network, infrastructure and platform architectures) and deployed by the pipeline. Manual changes in production are incidents. Drift between the sources and what's running is detected daily and reverted. That includes the code: the pipeline records which commit it deployed to each service, and the daily drift detection compares what runs with the commit of its last approved verdict. Code that runs without a verdict is drift.
**Why.** A configuration that only exists on the device can't be reviewed, tested or rebuilt. Neither can code that only exists on a server: a release that was never pushed, or a fix made by hand, is a version nobody judged.
**Verified by.** `test`: daily drift detection, of configuration and of the deployed commit, and a check that generated configuration in the repository matches its sources.

### DEL-05: The peak freeze protects the deadline
**Rule.** During the peak freeze (April 16 to May 3), class A and B services release only fixes for production incidents and security findings rated *High* or *Critical*. The Governance Agent applies this automatically, based on the release candidate's declared purpose and its actual diff. Class C services are not frozen.
**Why.** The days around the deadline are the worst time to learn something new about a change.
**Verified by.** `test`: the pipeline checks dates and resilience class. `review`: the Governance Agent checks that a "fix" is really a fix.

### DEL-06: Checks verify the output, not the intent that produced it
**Rule.** A check reads what was actually produced (the generated firewall rules, the load balancer and database configuration, the deployed artifact) and compares it with the intent, never asking the code that produced it. A check that asks the generator "what did you mean to do?" proves only that the generator agrees with itself. There are two tiers:
- The **authority** runs the real software, in the version production runs (each architecture's `runtime-versions.yaml`), and observes behavior. nftables is loaded in a network namespace and probed. HAProxy is started against stub backends and read through its stats socket. Patroni's settings are read back from the running cluster. A syntax check (`nft -c`, `haproxy -c`) proves the configuration loads, not what it does.
- **Readers** read the generated text quickly, for early signal. Each reader's grammar is an explicit allowlist of what the renderer produces, so any statement outside it, valid or not, is refused. A reader may only fail early. A reader's pass without the authority is incomplete, never a pass. Every result records which tier produced it.

Every checker ships with the mutations it must catch: deliberately broken output (a dropped rule, `ct state new accept`, `verify none`, a watchdog turned off). Those mutations are the readable specification where "who checks the checkers" ends.
**Why.** Different models have different blind spots ([AGT-03](ai-agents.md#agt-03-independence-comes-from-separate-contexts)), and so does deterministic code: a renderer and a verifier built on the same structures fail together. When a renderer bug passes every check, the checks were testing the renderer's intentions, not the configuration that will run.
**Verified by.** `test`: the readers ([nft.ts](../../network/tools/nft.ts), [check-output.ts](../../infrastructure/tools/check-output.ts)) and the authorities ([network](../../network/tools/authority.ts), [infrastructure](../../infrastructure/tools/authority.ts), [Patroni](../../infrastructure/tools/check-patroni-config.ts)) run in every pipeline; their mutation tests run with every change to the tools. Where an authority can't run (no Linux, or the wrong version), the result is INCOMPLETE. `review`: a new checker comes with its mutation tests.

### DEL-07: A change that can lock you out reverts itself unless confirmed
**Rule.** A change to firewall policy, access configuration, or anything else that can cut off the people and processes that apply changes, is applied with an automatic revert. The previous state is saved; the change is tested first where it can be (in a network namespace, in acceptance); and it is kept only when it is confirmed from a new session within a stated time. Otherwise it reverts by itself.
**Why.** A change that locks out the session that applied it can't be fixed from that session. A revert that needs nobody to be connected is the only undo that always works.
**Verified by.** `test`: the deployment process's own tests show an unconfirmed change reverting, and a confirmed one staying. `review`: the Governance Agent checks that a change of this kind is deployed this way.

### DEL-08: A deployment does only what it was granted, by name
**Rule.** A deployment does nothing by default. Each step of a release's deployment, and of its rollbacks, is one of the pre-approved actions for the application's platform ([deployment-actions.yaml](../pipeline/deployment-actions.yaml)), on a target the application was granted by name: its service's VMs, a unit, a database, a path on the file storage, a solution, a store listing. The grants are in `governance/deployment-grants/<application>.yaml`, one file per application, never in the application's repository. Each grant records who approved it and why. A grant is approved by the steward of the shared system it touches together with the Governance Agent, or by the Architecture Board when it would break intent declared earlier ([OWN-10](ownership.md#own-10-a-shared-system-has-one-steward)). The grants files are gate inputs, signed as [SEC-14](security.md#sec-14-the-gates-inputs-change-only-with-two-people) requires. Each action is a command of the deployment process, from Central IT's infrastructure repository, which checks its input before it changes anything. The deployment process runs those commands and nothing else, and an application's own code never runs with the deployment process's rights. A step that isn't granted fails at intake, and the Governance Agent escalates the request for its grant. The deployment process reads the grants from the approved architecture, never from the candidate.
**Why.** The Board: "A deployment can change only what the Board has seen and approved, by name, so no release can quietly gain rights on the host. It also acts as small safeguard than an approved application expands it scope unapproved." One file per application, because each application's rights are reviewed on their own, with a history of their own: a change to one application's rights touches only its file, and auditing it doesn't mean reading every application's.
**Verified by.** `test`: [check-deployment.ts](../tools/check-deployment.ts) refuses a step that isn't a pre-approved action for the platform or isn't granted, a unit that asks for more than a workload may have, and a grant without an approval or a reason. `review`: the deployment process's identity can run its commands and nothing else.

### DEL-09: Every release has a deployment plan, and every step a rollback
**Rule.** Every release candidate has a deployment plan, `releases/<id>/deployment-plan.yaml`: its steps, in order, and its rollbacks ([deployment.md](../pipeline/deployment.md#the-deployment-plan)). Every step says whether the application must stop for it or can keep running through it. A class A or B service in the datacenters never stops: its steps all keep it running, because it is deployed rolling, with serving instances throughout. Every step that changes production is covered by exactly one rollback: its own, or one that undoes several steps together. A rollback consists of executable actions, never a description: for a migration, its down migrations, or a restore of a backup the plan made before it ([DAT-07](data.md#dat-07-schema-changes-are-versioned-and-each-has-its-way-back)). How a rollback restores the known-good state is the application's choice; that it does is the requirement ([DEL-03](#del-03-every-release-can-be-rolled-back-to-a-known-good-state)).
**Why.** The Board: "A deployment plan should come with one set of deployment actions, and each action a rollback plan (or, if too complex, a rollback of some combined steps or all steps)", and "when I say plan, I mean an executable action." On stopping: "During deployment, the application is down when the old application can't work with a new data model." On how: "not relevant from an EA point of view. Our requirement is that we can rollback. Period." That class A and B services never stop is already NATAX's rolling deployment ([deployment.md](../pipeline/deployment.md#rolling-deployment-to-production)); the plan only says so.
**Verified by.** `test`: [check-deployment.ts](../tools/check-deployment.ts). `review`: the Governance Agent's deployment pass checks the order (expand before contract), that every state between steps works, that "keeps-running" is true wherever a step claims it, and that each rollback restores what its steps changed.
