# Deployment

The deployment process is the only identity with production write access. It deploys a candidate's artifact, identified by digest ([DEL-01](../principles/delivery.md#del-01-every-change-is-a-release-candidate-with-evidence)), to test and acceptance as part of the candidate's evaluation, and to production only once the pipeline's verdict store holds an approved verdict for that digest ([verdict.md](verdict.md)). A verdict anywhere else, such as the copy in the application's repository, is never a reason to deploy.

Most of this page describes services in DC1 and DC2. Power Apps and Android apps are delivered differently; see [per platform](#per-platform) below. The environments are the same idea everywhere: test and acceptance with synthetic data ([DAT-04](../principles/data.md#dat-04-non-production-environments-use-synthetic-data-only)), then production, and nothing reaches production by any other route.

## Order of changes

A release can change the application, the database schema, the network policy and the load balancer at once. The order matters. The rule is **expand before, contract after**:

1. **Expand.** Add new network paths, new load balancer configuration and new database grants. Apply expanding schema migrations. All of these must be harmless for the current version of the application.
2. **Deploy the application**, rolling (below).
3. **Contract**, only after the new version is verified everywhere, and only in a *later* release: remove network paths, load balancer configuration, grants and schema elements the old version needed.

This way, every intermediate state is one in which both the old and the new version work. That is what makes rollback possible at any point ([DEL-03](../principles/delivery.md#del-03-every-release-can-be-rolled-back-in-minutes)).

## Test and acceptance

Deploy the artifact, apply the expand steps, then run what the impact requires ([checks.md](checks.md)): integration tests, contract tests, targeted network probes for new and removed paths, the [Security Agent](../agents/security-agent.md)'s attack, failure tests, the migration upgrade test, and the rollback rehearsal. Any failure is a rejection with a path forward.

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

Rollback is a separate procedure, built for speed rather than caution: it redeploys the previous artifact to every instance, one datacenter at a time, without verification windows between instances. It must restore service within 10 minutes ([DEL-03](../principles/delivery.md#del-03-every-release-can-be-rolled-back-in-minutes)). Observation continues afterwards. Schema migrations are not reversed: because they are backward compatible, the previous version runs on the new schema ([DAT-07](../principles/data.md#dat-07-schema-changes-are-versioned-and-backward-compatible)).

## Per platform

| | Power Apps | Android |
|---|---|---|
| **Artifact** | The managed solution, packed and checked by the pipeline | The signed release bundle, built by the pipeline, which holds the upload key |
| **Test and acceptance** | Imported into the test environment, with test connections and synthetic data; the Playwright and permission tests run there | Installed on managed emulators and test devices, against the backend's test environment |
| **Production** | Imported into the production environment by the deployment process's own identity; connection references and environment variables set from the release | Published to NATAX's managed app store as a private app, in stages: 5% of devices, then 25%, then everyone, each stage observed for a day |
| **Verification** | Flow failures and the app's errors compared with the hour before | Crash rate and the backend's error rate for the new version, compared with the previous version; a crash rate above the alert threshold halts the rollout |
| **Rollback** | Re-import the previous managed solution | Halt the rollout and ship the previous build with a higher version code; old versions keep working against the API ([AND-12](../../platforms/android/standards.md#and-12-old-versions-can-be-retired)) |
| **Data changes** | Provisioning scripts, backward compatible across one release | Room migrations on the device; the backend's API stays compatible with every version still in use |

## Registration

At an application's first release candidate, the pipeline registers it in the [landscape](../landscape/landscape.md) as "in development" ([OWN-08](../principles/ownership.md#own-08-every-application-is-in-the-landscape)): its purpose, users, Problem Owner and platform from `architecture.yaml`. At its first production deployment, the deployment process marks it "in production" and, for applications in the datacenters, adds its entry to `landscape.yaml`. Every later release updates the entry. Retiring an application removes it ([OWN-06](../principles/ownership.md#own-06-decommissioning-is-a-release)).

## The release record

After deployment, the process appends `releases/<id>/deployment.md` to the application's repository: what was deployed, where, when, the verification results, and any rollback. Together with the candidate and the verdict, this is the release history ([OWN-05](../principles/ownership.md#own-05-the-repository-is-the-system-of-record)). The deployment process's own logs are kept centrally, where neither the application nor the pipeline can change them.
