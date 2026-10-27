# Platforms

A Problem Owner chooses a platform for their solution, with the Development Agent's help. The architecture doesn't: every platform is held to the same central principles, the same network and infrastructure architectures, and the same pipeline. What differs is **how** each platform meets them, and what each platform is **not** for.

| Platform | For | Limits | Architecture |
|---|---|---|---|
| **TypeScript web application** | Anything that needs real logic, integration with NATAX systems, customers, or class A resilience. Internal tools, customer-facing applications, APIs (including the APIs Android apps talk to). | None beyond the central rules | [typescript-web](typescript-web/README.md) |
| **Power Apps** | Forms, lists and simple workflows for staff, with data that lives in Microsoft 365. A team's rota, an approval flow, an inventory of equipment. | Staff only; class B or C; up to Confidential; availability is Microsoft 365's | [power-apps](power-apps/README.md) |
| **Android app** | Staff who work away from a desk, or need the device itself: a camera, a scanner, offline use. | Staff on NATAX-managed devices; talks to NATAX only through an API at the edge; nothing above Confidential on the device | [android](android/README.md) |

The limits are machine-readable, in each platform's `platform.yaml`, and checked on every release. A Power App can't quietly become class A.

## Choosing

The Development Agent asks about the problem, not the technology, and proposes the simplest platform that fits:

1. **Does something in the [landscape](../enterprise-architecture/landscape/landscape.md) already do this?** Then use it or extend it ([SIM-09](../enterprise-architecture/principles/simplicity.md#sim-09-look-before-you-build)). The best platform is the one already running.
2. **Is it a list, a form, or an approval, for staff, with data that could live in SharePoint or Dataverse?** Power Apps. It's the quickest to build and to change, and the Problem Owner can see and adjust it themselves.
3. **Does it need to work away from a desk, offline, or with the device's camera or scanner?** Android, with its backend as a TypeScript API, or an existing NATAX API. If a web application in the phone's browser would do, that's simpler.
4. **Otherwise**: logic, integration, customers, taxpayer data or class A: TypeScript.

When the answer changes later, because the requirements grew, the platform can change too. A Power App that outgrows its limits is rebuilt in TypeScript, with its data migrated. That's not a failure of the first choice; it's learning as you go.

## How each platform meets the always-applied architecture

| Concern | TypeScript web | Power Apps | Android |
|---|---|---|---|
| **Network** ([network](../network/README.md)) | Host firewalls generated from `consumes`/`provides`; the egress proxy for the internet | DLP policies decide which connectors an app may use ([PA-08](power-apps/standards.md#pa-08-dlp-policies-are-a-boundary-not-an-authorization)); NATAX systems only through their APIs, from the Power Platform's own subnet (a zone in the network policy), as the signed-in user ([PA-09](power-apps/standards.md#pa-09-natax-systems-only-through-their-apis-as-the-signed-in-user)) | No network trust: the device reaches only its API at the edge (`staff-edge`), with the user's token from a compliant device ([AND-05](android/standards.md#and-05-the-app-talks-only-to-natax-apis-by-identity-not-by-network)) |
| **Availability** ([infrastructure](../infrastructure/README.md)) | DC1 and DC2, active/active; health checks; capacity for the planning peak | Microsoft 365's, accepted once by the Board ([RES-11](../enterprise-architecture/principles/resilience.md#res-11-saas-platforms-and-devices)) | The backend's; the app works offline and catches up ([RES-11](../enterprise-architecture/principles/resilience.md#res-11-saas-platforms-and-devices)) |
| **Identity** | OIDC with the workforce or customer IdP; workload certificates | Entra ID; users act as themselves; access through security groups only | The IdP's broker, so device compliance counts |
| **Data security** | Database grants for a least-privileged runtime role | **At the data source**: SharePoint permissions or Dataverse security roles, never by hiding things in the app | Nothing above Confidential on the device; sealed with a Keystore key; erased on sign-out |
| **Observability** | JSON logs, `/metrics`, `/health/*`, alerts with runbooks | Flow run history and the platform's analytics; an alert on flow failures | Crash reports and metrics to NATAX's observability; an alert on crash rate |
| **Delivery and recovery** | The pipeline deploys an artifact by digest, rolling; rollback in minutes; PostgreSQL backups | The pipeline imports a managed solution; rollback is re-importing the previous version; the data's recovery is Microsoft 365's, plus the platform's backups | The pipeline publishes a private app, in stages; rollback is halting the rollout and shipping the previous build; the device holds nothing that needs recovering |
| **Deterministic checks** | Type check; tests against a real database, as the runtime role | Managed solution build, solution checker; Playwright tests of the app and of the data source's permissions | Gradle check, lint, tests on managed emulators, dependency verification |

## Central rules that work differently per platform

Most central rules apply to every platform as written. These were written for services in NATAX's datacenters; this is how Power Apps and Android meet them. The mapping is part of each platform's architecture, approved by the Board with its version.

| Rule | Power Apps | Android |
|---|---|---|
| [IAM-02](../enterprise-architecture/principles/identity-and-access.md#iam-02-applications-dont-handle-passwords) sessions and cookies | The platform's own sign-in and session, with the workforce IdP's policy | Tokens from the IdP's broker, kept by the broker or sealed (AND-04) |
| [IAM-05](../enterprise-architecture/principles/identity-and-access.md#iam-05-every-workload-has-its-own-identity) workload certificates | Calls into NATAX carry the user's own OAuth token (PA-09); the Power Platform has no NATAX workload identity | The app has no workload identity: it calls with the user's token (AND-05); its backend follows IAM-05 |
| [DAT-07](../enterprise-architecture/principles/data.md#dat-07-schema-changes-are-versioned-and-each-has-its-way-back) schema changes | Solution versions and provisioning scripts, backward compatible across one release | Room migrations on the device; the API stays compatible with app versions in use (AND-12) |
| [DAT-08](../enterprise-architecture/principles/data.md#dat-08-a-backup-isnt-a-backup-until-it-has-been-restored) backups | Microsoft 365's and Dataverse's backups and retention; Confidential data exported to NATAX's backup store where the Problem Owner's statement requires more | Not applicable: the device holds only expiring copies; the server is the system of record |
| [RES-02](../enterprise-architecture/principles/resilience.md#res-02-dc1-and-dc2-are-both-production-all-the-time) to [RES-05](../enterprise-architecture/principles/resilience.md#res-05-one-writer-at-a-time), [RES-09](../enterprise-architecture/principles/resilience.md#res-09-resilience-is-tested-not-asserted), [RES-10](../enterprise-architecture/principles/resilience.md#res-10-known-peaks-are-provisioned-for-not-hoped-for) | Not applicable ([RES-11](../enterprise-architecture/principles/resilience.md#res-11-saas-platforms-and-devices)); the NATAX APIs it calls follow them | Apply to the backend, not the app |
| [RES-06](../enterprise-architecture/principles/resilience.md#res-06-healthy-means-ready-to-serve), [OBS-02](../enterprise-architecture/principles/observability.md#obs-02-metrics-show-what-users-feel), [OBS-03](../enterprise-architecture/principles/observability.md#obs-03-health-endpoints-are-mandatory) health and metrics endpoints | Not applicable; the platform's monitoring and an alert on flow failures instead | Apply to the backend; the app reports crashes and metrics (AND-11) |
| [OBS-01](../enterprise-architecture/principles/observability.md#obs-01-logs-are-structured-central-and-clean) logs | Run history, with secure inputs and outputs (PA-07); the tenant's audit log | No sensitive data in release logs (AND-03) |
| [DEL-01](../enterprise-architecture/principles/delivery.md#del-01-every-change-is-a-release-candidate-with-evidence), [DEL-03](../enterprise-architecture/principles/delivery.md#del-03-every-release-can-be-rolled-back-to-a-known-good-state) artifact and rollback | The managed solution is the artifact; rollback re-imports the previous one | The signed release bundle is the artifact; rollback halts the staged rollout and ships the previous build |

## Adding a platform

A new platform is an architecture change, proposed to the Board ([proposal template](../enterprise-architecture/templates/architecture-proposal.md)). It needs the same parts as the existing ones: `platform.yaml` with its limits, standards that map every concern and rule above, a bootstrap procedure, agent instructions, and the deterministic checks the pipeline runs. And it needs a reason: what problem do the existing platforms leave unsolved ([SIM-01](../enterprise-architecture/principles/simplicity.md#sim-01-every-component-must-earn-its-place))?
