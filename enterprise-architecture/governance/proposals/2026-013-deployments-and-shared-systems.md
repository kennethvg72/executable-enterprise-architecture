# Proposal 2026-013: Deployments and shared systems

Architecture: enterprise-architecture, network, infrastructure, android, typescript-web
Proposed version: enterprise-architecture 5.0.0, network 2.0.0, infrastructure 3.0.0, android 2.0.0 (new mandatory rules); typescript-web 1.3.1 (links only)
Proposed by: Architecture Board
Date: 2026-10-27

## Problem

A deployment is more than replacing an artifact: database migrations, files, units, timers, tools on hosts, network paths, load balancer frontends. The Governance Agent judged a candidate's code, and the deployment process deployed an approved digest, but nothing judged *how* a release is deployed, although that is where the candidate's code comes closest to the deployment process's rights. And many of those steps touch systems every application uses: the network above all, but also the load balancers, DNS, the secret store, the file storage, alert routing, mail addresses, the database clusters and the Power Platform's DLP policies. Each team changed its own corner of them, and nobody kept the whole.

Rollback had the same gap. "Without restoring data" made a migration that drops something impossible to undo, and an Android release could only be "rolled back" by building the previous code again, which DEL-01 forbids.

## Change

1. **A deployment does only what it was granted, by name** ([DEL-08](../../principles/delivery.md#del-08-a-deployment-does-only-what-it-was-granted-by-name)). Nothing by default. Each step is a pre-approved action for the application's platform ([deployment-actions.yaml](../../pipeline/deployment-actions.yaml)), a command of the deployment process, on a target granted by name in `governance/deployment-grants/<application>.yaml`. A step that isn't granted fails at intake, and the Governance Agent escalates the request for its grant.
2. **Every release has a deployment plan, and every step a rollback** ([DEL-09](../../principles/delivery.md#del-09-every-release-has-a-deployment-plan-and-every-step-a-rollback)). Each step says whether the application must stop for it; a class A or B service in the datacenters never stops. Every step that changes production is covered by exactly one rollback, of executable actions.
3. **Rollback returns to a known-good state, data included** ([DEL-03](../../principles/delivery.md#del-03-every-release-can-be-rolled-back-to-a-known-good-state), changed). Automatically during the verification window, with the Board's approval after it; within 10 minutes without a data restore, as long as a careful restore needs with one. No rehearsal in acceptance: the Central Agents judge.
4. **Every migration has its way back** ([DAT-07](../../principles/data.md#dat-07-schema-changes-are-versioned-and-each-has-its-way-back), changed). A down migration, or a restore of a backup the plan made first.
5. **Packages on hosts change only with the infrastructure** ([INF-11](../../../infrastructure/standards.md#inf-11-packages-on-hosts-change-only-with-the-infrastructure)).
6. **A shared system has one steward** ([OWN-10](../../principles/ownership.md#own-10-a-shared-system-has-one-steward), the [steward agent](../../agents/steward-agent.md)). Shared systems are declared in the landscape, each with its steward, working for the team that owns it. The steward alone writes the source, with an intent for every entry; it writes deterministic tests from the intents, never from its own entries, judges what no rule can decide, turns judgments into tests, and runs the same tests as probes against the live system.
7. **The network's steward is the Network Agent** ([network agents](../../../network/agents/README.md#network-agent), ZTN-01 changed). The network Test Agent's expectations, written from intent, become the Network Agent's duty. **The network's rules are read only by those who need them** ([ZTN-10](../../../network/standards.md#ztn-10-the-networks-rules-are-read-only-by-those-who-need-them)); an application sees its own flows. In this repository they stay public, under exception EXC-2026-004.
8. **Android rolls back by reinstalling the previous release's own artifact** ([AND-13](../../../platforms/android/standards.md#and-13-offline-work-survives-an-update-and-a-rollback)): halt the rollout; the backend refuses the version and tells it to send its outbox; device management uninstalls the app and installs the previous signed APK on each device that updated, once its outbox is empty. Sync is versioned, across two versions. AND-01 and AND-12 say what that needs from device management and the backend.
9. **The Board's files, one per subject**: `governance/exceptions/<subject>.yaml` replaces `exceptions.yaml` (a subject is an application, a shared system or a site), and `governance/deployment-grants/<application>.yaml` is new, with rejection-triage's grants as the first. The pipeline shows the shared systems' exceptions on every candidate.
10. **Two anti-patterns**, with their regression samples: [AP-21](../../anti-patterns.md#ap-21-riding-someone-elses-rule), riding someone else's rule, and [AP-22](../../anti-patterns.md#ap-22-the-deployment-that-brings-its-own-script), the deployment that brings its own script.
11. **The tools**: [check-deployment.ts](../../tools/check-deployment.ts), in the pipeline's deterministic stage, with its tests.

## The Board's decisions

Taken on 2026-10-27.

| | Decision | The Board's choice | Why |
|---|---|---|---|
| 1 | What a deployment may do | Declared steps, from a set of pre-approved actions; nothing by default; each right granted by name | The Board: "A deployment can change only what the Board has seen and approved, by name, so no release can quietly gain rights on the host. It also acts as small safeguard than an approved application expands it scope unapproved." |
| 2 | Where the grants and exceptions are | One file per subject, in `governance/`; the exceptions too, in this change | Each application's rights are reviewed on their own, with a history of their own. On moving the exceptions now: "No backlog; fix exceptions.yaml with this change please! Humans are allowed to be lazy, AI not". |
| 3 | Tools on hosts | Only through a release of the infrastructure | The Board: "A package changes the host for every application on it, so it is the host's decision, not one application's. This to prevent installing applications that might reduce security of the host, or break dependencies of other tools and applications" |
| 4 | Rollback | A plan per release; every step a rollback, executable; one rollback may cover several steps | The Board: "A deployment plan should come with one set of deployment actions, and each action a rollback plan (or, if too complex, a rollback of some combined steps or all steps)"; "when I say plan, I mean an executable action." |
| 5 | Data in a rollback | Included: when undoing a migration deletes data, the plan backs it up first, and the rollback restores it | The Board: "Rollback means going back to a known-good-working-state. That includes data. Why? To minimize downtime." |
| 6 | How it is restored | The application's choice | The Board: "not relevant from an EA point of view. Our requirement is that we can rollback. Period." |
| 7 | How long a restore may take | As long as a careful restore needs | The Board: "it is an event that should not happen regularly, as it means a development failure. In that case, it is acceptable that the downtime is a bit longer. A rushed restore often means more risk." |
| 8 | When a rollback may run | At once, automatically, in the verification window; after it, only with the Board's approval | "Ideally, immediately or never": after the window, a rollback throws away real work done since the release, so someone has to decide that it's worth it. |
| 9 | Stopping the application | Each step says whether it must | The Board: "During deployment, the application is down when the old application can't work with a new data model. So each deployment step should indicate: 'shut down application' or 'application can keep running'". |
| 10 | Rehearsal | None, also not in acceptance | The Board: "The Central Agents judge the deployment/rollback, they don't rehearse. If that seems to break for an application, then we will cross that bridge when we get there." |
| 11 | Proving "keeps-running" for a migration | The previous release's tests, against the new schema | An ordinary test, not a rehearsal, and it proves the one claim that is hard to judge by reading. |
| 12 | Shared systems | Declared, each with one steward; one role for all of them | The Board: "we should explicitly declare some systems as shared. Then, for shared systems, I think we should have a dedicated agent", and "Can't we generalize it? I feel otherwise we end up with 'this is a namespace except for ...'". |
| 13 | A steward's tests | Deterministic where a rule can decide; intent-based judgment otherwise, turned into tests; the same tests as probes | The Board: "an agent writes deterministic tests for namespace checks, and does intent-based checks otherwise. And also writes deterministic tests for that. It would be great if we can for example later can plug in probes that run deterministic tests generated by the central agent." |
| 14 | Who approves a change to a shared system | The steward and the Governance Agent; the Board when intent declared earlier would break | The Board's attention goes where intents conflict: a declared change that conflicts with nothing is routine. |
| 15 | Where the network's rules are | A repository of their own, read only by those who need them | The Board: with the rules where every application can read them, "all applications can see the total firewall rules, which is a) a security risk and b) an application might see 'ah, port ABCD is already allowed, so I will use that port' only for it to break X years in the future when that port is blocked." |
| 16 | NATAX's generated rules in this repository | They stay, with a note, under a Board exception | The Board: "keep them in but note that in a production environment they should be in their own repository, and add it as exception". |
| 17 | Rolling back an Android release | Halt, refuse, then reinstall the previous release's own APK on each updated device, once its outbox is empty | The Board: "Work around android limitations". Android refuses only to *update* to an older version; uninstalling and installing the previous artifact is allowed, and reinstalls the same digest and signature, so DEL-01 holds and DEL-03 applies to Android too. It needs device management to keep each release's APK and push a specific one, which NATAX's does. |
| 18 | Offline work across updates and rollbacks | Sync is versioned; the server and the app accept work from the two previous versions; older work is refused | The Board: "Syncs must be versioned, and the new version must accept unsynced work from the previous 2 versions." "So that work done offline is never lost, whether the app is updated or rolled back, within reasonable limits: a device that is offline for a (long) period is out of luck if it still had unsaved changes. We live in an online world." |
| 19 | When to bring this to NATAX | Now, before it has been used in production | The Board: "it is a lesson learned already, and we will learn new lessons which we will then apply again." |

## Trade-off

- **The cost:**
  - Every release writes a plan, and every step a rollback.
  - Every application's rights are requested and granted once, by name.
  - The deployment process's commands are built per platform.
  - A steward per shared system, working for the team that owns it, and a Network Agent for the network specialists.
  - Android apps version their sync, and a rollback costs the affected devices a sign-in.
- **The gain:**
  - No release gains rights without someone seeing them by name.
  - Every deployment has a way back to a known-good state, data included, on every platform.
  - The candidate's code never runs with the deployment process's rights.
  - Every shared system has someone who knows why each of its parts is there, with tests that come from those reasons.

## Simplification

- The rollback rehearsal in acceptance goes.
- The network Test Agent's duties move to the Network Agent.
- One exceptions file per subject instead of one for everyone.
- An Android rollback is no longer a rebuild.

## Impact on the landscape

- **Every application**:
  - its next release candidate has a deployment plan, and asks for its grants: every action its deployment needs, and on what;
  - its migrations get down migrations.
- **rejection-triage**: its grants are the first, as the example.
- **Android apps**: versioned sync, and backends that can refuse a version.
- **Central IT**: the stewards, the Network Agent, the deployment process's commands, and device management that keeps each release's APK.

## Migration

enterprise-architecture 4.x, network 1.0.0, infrastructure 2.0.0 and android 1.x are deprecated, decommissioned 2027-06-01, after the filing season.

---

## Board decision

Date: 2026-10-27
Decision: accepted and activated.
Reasoning: The Board's, per decision, in the table above.
