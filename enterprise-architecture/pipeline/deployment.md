# Deployment

The deployment process is the only identity with production write access. It builds and deploys a candidate's artifact, identified by digest ([DEL-01](../principles/delivery.md#del-01-every-change-is-a-release-candidate-with-evidence)), to production only once the pipeline's verdict store holds an approved verdict for its commit ([verdict.md](verdict.md)). A verdict anywhere else, such as the copy in the application's repository, is never a reason to deploy.

Most of this page describes services in DC1 and DC2. Power Apps and Android apps are delivered differently; see [per platform](#per-platform) below. The environments are the same idea everywhere: test and acceptance with synthetic data ([DAT-04](../principles/data.md#dat-04-non-production-environments-use-synthetic-data-only)), where the team's Test Agent tests, then production, and nothing reaches production by any other route.

## What a deployment may do

A deployment does only what its plan says, and only what was granted ([DEL-08](../principles/delivery.md#del-08-a-deployment-does-only-what-it-was-granted-by-name)). Every step is one of the [pre-approved actions](deployment-actions.yaml) for the application's platform, on a target the application was granted by name in `governance/deployment-grants/<application>.yaml`. The deployment process reads the grants from the approved architecture, never from the candidate. Each action is one of its commands, from Central IT's infrastructure repository, which checks its input before it changes anything; the deployment process runs those commands, and nothing else.

## The deployment plan

Every release candidate has one, `releases/<id>/deployment-plan.yaml` ([DEL-09](../principles/delivery.md#del-09-every-release-has-a-deployment-plan-and-every-step-a-rollback)): what this release does, step by step, and how each step is undone. The application's manifest and its grants say what it *may* do; the plan says what *this* release does.

```yaml
steps:
  - id: backup-triage
    action: backup
    target: rejection_triage           # its database, on app-db
    application: keeps-running         # or must-stop; a class A or B service never stops
  - id: migrate
    action: migrations
    target: rejection_triage
    application: keeps-running         # the previous version works on the new schema (DAT-07)
    files: [db/migrations/0042-add-callback-slots.sql]
  - id: release
    action: vm-release
    target: rejection-triage           # its service: its VMs in DC1 and DC2, rolling
    application: keeps-running
rollbacks:
  - covers: [migrate, release]         # one rollback for several steps together
    steps:
      - { action: vm-release, target: rejection-triage, application: keeps-running }   # the previous artifact
      - { action: migrations, target: rejection_triage, application: keeps-running, files: [db/migrations/0042-add-callback-slots.down.sql] }
```

- **Every step** is a pre-approved action for the platform, on a granted target, and says whether the application must stop for it. A class A or B service in the datacenters never stops: it is deployed rolling, below.
- **Every step that changes production** is covered by exactly one rollback, which contains what undoes it on the same target. A backup changes nothing the application runs on, so it needs none.
- **A rollback is executable actions**, never a description. For a migration, that is its down migrations, or a restore of a backup the plan made before it, `{ action: restore, target: rejection_triage, from: backup-triage }` ([DAT-07](../principles/data.md#dat-07-schema-changes-are-versioned-and-each-has-its-way-back)). When undoing it would delete data, the plan backs that data up first.
- **Not in a plan:** the network, the load balancers, DNS, the secret store, alert routing, mail addresses and the Power Platform's DLP policies are shared systems, changed by their stewards ([OWN-10](../principles/ownership.md#own-10-a-shared-system-has-one-steward)). A release that needs a change there declares it in its manifest, and the shared system's change is released before it. Packages on hosts change with the infrastructure ([INF-11](../../infrastructure/standards.md#inf-11-packages-on-hosts-change-only-with-the-infrastructure)).
- **A step that isn't granted** fails at intake. The Governance Agent escalates the request for the grant: to the steward of the shared system it touches, or to the Architecture Board when it would break intent declared earlier.

`check-deployment.ts` checks all of this before anything runs. The Governance Agent judges what no rule can decide: the order, whether every state between steps works, whether "keeps-running" is true, and whether each rollback really restores the known-good state.

## Order of changes

A release can change the application, the database schema and its files at once; the network paths and load balancer configuration it needs are their stewards' changes, released before it. The order matters. The rule is **expand before, contract after**:

1. **Expand.** Add new database grants, directories and files. Apply expanding schema migrations. All of these must be harmless for the current version of the application.
2. **Deploy the application**, rolling (below).
3. **Contract**, only after the new version is verified everywhere, and only in a *later* release: remove grants, files and schema elements the old version needed; the stewards remove the network paths and load balancer configuration.

This way, every intermediate state is one in which both the old and the new version work. That is what makes rollback possible at any point ([DEL-03](../principles/delivery.md#del-03-every-release-can-be-rolled-back-to-a-known-good-state)).

## Before the verdict, nothing runs

Nothing of the candidate runs centrally before the verdict ([SEC-13](../principles/security.md#sec-13-the-pipeline-treats-every-release-candidate-as-hostile)). The team's Test Agent runs what the impact requires ([checks.md](checks.md)) in test and acceptance, and records it as the candidate's evidence ([DEL-02](../principles/delivery.md#del-02-tests-are-part-of-the-change)):
- integration tests and contract tests;
- failure tests;
- for a migration the application keeps running through, the previous release's tests against the new schema ([DAT-07](../principles/data.md#dat-07-schema-changes-are-versioned-and-each-has-its-way-back)).

The Network Agent's targeted probes for new and removed paths run there too: they test the network's policy, not the candidate's code. The pipeline audits the evidence. A failed or missing test is a rejection with a path forward. Nobody rehearses the deployment or its rollback: the Central Agents judge them ([DEL-03](../principles/delivery.md#del-03-every-release-can-be-rolled-back-to-a-known-good-state)).

The build and the deployment are the one place where a candidate's code runs centrally: its build scripts, its steps, its migrations, with the rights its grants give it. How that is contained is settled with the first deployment that needs it.

## Rolling deployment to production

1. **First instance**: take one instance in DC1 out of the load balancer (by failing its readiness), deploy, verify readiness, put it back, then observe it under real traffic for the verification window.
2. **The rest**: the remaining instances, one at a time, alternating between datacenters, each observed for the verification window.

A service never has zero serving instances. Class A services also keep at least one serving instance in each datacenter throughout, so they need at least two instances per datacenter. A class B service with one instance per datacenter is served from the other datacenter while its instance is updated.

## Verification and automatic rollback

After each step, the pipeline compares the new instances with the same instances in the hour before the deployment ([OBS-06](../principles/observability.md#obs-06-every-deployment-is-verified-and-rolled-back-if-needed)). The verification window is 10 minutes, extended until the new instances have served at least 200 requests. Where traffic is too low to reach that, the pipeline adds synthetic requests from the application's smoke tests.

It rolls back automatically if, within the window:

| Signal | Rolls back when |
|---|---|
| Error rate (5xx responses) | Above 1% **and** at least double the previous level |
| p95 latency | Above 1.5 times the previous level **and** at least 100 ms worse |
| Readiness | Failing for more than 60 seconds on any new instance |
| Alerts | An alert owned by the application starts firing, or gets worse, after the step |

The absolute floors keep a quiet service from rolling back because one request in fifty failed.

## Rollback

Rollback runs the plan's rollbacks, for the steps that ran, in reverse order: it returns to the known-good state before the release, data included ([DEL-03](../principles/delivery.md#del-03-every-release-can-be-rolled-back-to-a-known-good-state)). It is a separate procedure, built for speed rather than caution: in the datacenters it redeploys the previous artifact to every instance, one datacenter at a time, without verification windows between instances. Observation continues afterwards.

- **When.** During the verification window, the pipeline rolls back by itself, at once. After the window, a rollback runs only with the Architecture Board's approval: by then it would throw away real work done since the release. Going forward with a fix is a new release.
- **How long.** A rollback that restores no data restores service within 10 minutes. One that restores data takes as long as a careful restore needs.
- **Migrations** are undone by their down migrations, after the previous artifact is back on every instance (it runs on the new schema, DAT-07), or by restoring the backup the plan made before them. A backup the plan made is production data: it has the data's classification, and it is kept until the next release's plan replaces it, so a rollback the Board approves after the window still has it ([DAT-05](../principles/data.md#dat-05-retention-is-defined-and-automated)). The scheduled backups are separate, and no deployment touches them ([DAT-08](../principles/data.md#dat-08-a-backup-isnt-a-backup-until-it-has-been-restored)).

## Per platform

| | Power Apps | Android |
|---|---|---|
| **Artifact** | The managed solution, packed by the pipeline after the verdict; the solution checker's result is the Test Agent's evidence | The signed release bundle, built by the pipeline after the verdict, which holds the upload key |
| **Test and acceptance** | Imported into the test environment by the team, with test connections and synthetic data; the Test Agent runs the Playwright and permission tests there, and records them | Installed by the team on managed emulators and test devices, against the backend's test environment; the Test Agent records the tests |
| **Production** | Imported into the production environment by the deployment process's own identity; connection references and environment variables set from the release | Published to NATAX's managed app store as a private app, in stages: 5% of devices, then 25%, then everyone, each stage observed for a day |
| **Verification** | Flow failures and the app's errors compared with the hour before | Crash rate and the backend's error rate for the new version, compared with the previous version; a crash rate above the alert threshold halts the rollout |
| **Rollback** | Re-import the previous managed solution (`solution-import`) | Three steps, together ([AND-13](../../platforms/android/standards.md#and-13-offline-work-survives-an-update-and-a-rollback)): halt the rollout; the backend refuses the version and tells it to send its outbox; then, on each device that updated and once its outbox is empty, device management uninstalls the app and installs the previous release's own signed APK. No rebuild: the same artifact, by digest ([DEL-01](../principles/delivery.md#del-01-every-change-is-a-release-candidate-with-evidence)) |
| **Data changes** | Provisioning scripts, backward compatible across one release | Room migrations on the device; the backend's API stays compatible with every version still in use, and sync accepts the outbox of the two previous versions (AND-13) |

## Registration

At an application's first release candidate, the pipeline registers it in the [landscape](../landscape/landscape.md) as "in development" ([OWN-08](../principles/ownership.md#own-08-every-application-is-in-the-landscape)): its purpose, users, Problem Owner and platform from `architecture.yaml`. At its first production deployment, the deployment process marks it "in production" and, for applications in the datacenters, adds its entry to `landscape.yaml`. Every later release updates the entry. Retiring an application removes it ([OWN-06](../principles/ownership.md#own-06-decommissioning-is-a-release)).

## The release record

After deployment, the process appends `releases/<id>/deployment.md` to the application's repository: what was deployed, where, when, the verification results, and any rollback. Together with the candidate and the verdict, this is the release history ([OWN-05](../principles/ownership.md#own-05-the-repository-is-the-system-of-record)). The deployment process's own logs are kept centrally, where neither the application nor the pipeline can change them.
