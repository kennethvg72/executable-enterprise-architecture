# Power Apps standards (PA)

How NATAX builds applications on the Power Platform: canvas and model-driven Power Apps, the Power Automate flows that belong to them, and their data in Dataverse or SharePoint lists. These rules implement the [central principles](../../enterprise-architecture/README.md) and the always-applied [network](../../network/README.md) and [infrastructure](../../infrastructure/README.md) architectures for this platform; where a central rule works differently here, [platforms/README.md](../README.md#central-rules-that-work-differently-per-platform) says how. They add to the central rules, and never relax them.

Power Apps make building so easy that a team can have a working app by lunchtime. That is the point, and also the risk. These rules keep the first part and remove the second.

## Limits

[platform.yaml](platform.yaml), checked on every release: staff only (no Power Pages, no guests); class B or C; up to Confidential, so Taxpayer-Restricted data never enters the Microsoft 365 tenant; data in Dataverse or SharePoint lists, not in Excel files, Access or a personal OneDrive.

### PA-01: Microsoft 365's availability is accepted, once, by the Board
**Rule.** The Board accepts the platform's dependency on Microsoft 365 once ([RES-11](../../enterprise-architecture/principles/resilience.md#res-11-saas-platforms-and-devices)). The Problem Owner's resilience statement says what users do when Microsoft 365 is down; an app that needs more is rebuilt on a platform NATAX can fail over.
**Why.** When Microsoft 365 is down, email, Teams, documents and sign-in are down too, and most office work stops with them. An app that must keep working through that doesn't belong here.
**Verified by.** `test`: resilience class against `platform.yaml`. `review`: the resilience statement.

### PA-02: Security is enforced at the data source, never in the app
**Rule.** Anyone who can use an app can reach its data directly, without the app: a SharePoint list opens in the browser, exports to Excel and answers to the Graph API; Dataverse tables open in other apps and through the Web API. So access is decided **on the data**, for every user, as if the app didn't exist:

- **SharePoint lists:** every user of the app has exactly the permissions on the list that the app needs for their role, granted to the role's security group. Hiding a column, filtering a gallery or disabling a button decides what is *convenient*, not what is *allowed*. SharePoint has no column-level security: data that some users of the list may not see goes in a separate list, with its own permissions, or in Dataverse. Item-level permissions (breaking inheritance per item) are not used to separate users' data: they are fragile, invisible in the app, and don't scale. If rows must be visible to some users and not others, use Dataverse.
- **Dataverse:** security roles per app role, assigned to Entra group teams; row access by ownership, team or business unit, with access depth chosen deliberately; column security profiles for columns only some roles may see (checking first that the column type supports it). Privileges **add up**: a restrictive role never cancels a broader role or a share, so the Test Agent tests users who hold several roles.
- **Separate data per environment.** Development, test and production use separate SharePoint sites (or Dataverse environments), and identities used outside production can't reach production data ([SEC-07](../../enterprise-architecture/principles/security.md#sec-07-test-environments-cant-reach-production)). Lists, columns, permissions and retention are created by versioned provisioning scripts in the repository, not by hand: a solution import doesn't create SharePoint lists.

**Why.** "The app doesn't show it" is the most common Power Apps security hole there is. The data is one URL away from every user of the app.
**Verified by.** `test`: the Test Agent's permission tests run *against the data source*, as a user in each role, with several roles, and with no role, outside the app (PA-12). `review`: the Governance Agent compares the data-source permissions with the roles in `architecture.yaml`.

### PA-03: Choose the data store by who may see what
**Rule.** Use a **SharePoint list** when everyone who uses the app may see every row and column of the list, the list stays well below a few thousand rows, and the data has no relationships worth enforcing. Use **Dataverse** otherwise: when visibility differs per row or column, when there are relationships, when rows grow, or when reads must be audited (PA-15). The choice, and its licensing (Dataverse, custom connectors, Managed Environments and automation identities all have license requirements), is a decision record made before anything is built.
**Why.** SharePoint lists come with Microsoft 365, are simple, and are the right answer for a team's rota. They become the wrong answer as soon as some users may not see some rows. Dataverse costs premium licenses, which is the price of real security ([SIM-03](../../enterprise-architecture/principles/simplicity.md#sim-03-decide-build-versus-buy-on-todays-economics) applies).
**Verified by.** `review`: the decision record.

### PA-04: Queries are delegable, or they are wrong
**Rule.** Every query against a data source is delegable: filtered and sorted by the data source, not by the app. Delegation warnings are defects. Where a query can't be delegated, the *query* or the *data design* changes (a different formula, a Dataverse view, a Dataverse table instead of a list); raising the row limit is never the fix.
**Why.** A non-delegable query silently works on only the first 500 rows (2,000 at most), with no error. The app works perfectly in testing, with 40 rows, and starts giving wrong answers in production, quietly, when the data grows. Nobody notices until someone asks why their record isn't there.
**Verified by.** `test`: the Test Agent's tests with synthetic data generated above the delegation limit. `review`: no delegation warnings in the app.

### PA-05: Environments, and the pipeline as the only way into production
**Rule.**
- Every app lives in a **solution**. It is built in a **developer environment** belonging to the Problem Owner's team, never in the Default environment, which is for personal productivity only. Shared integration testing happens in a governed sandbox environment.
- **Test** and **production** are separate environments, governed as Managed Environments, each restricted to an Entra security group of the people allowed to use apps there. Only the pipeline's deployment identity can import, change or delete solutions there ([SEC-01](../../enterprise-architecture/principles/security.md#sec-01-only-the-central-pipeline-changes-production)). Makers, including the Problem Owner, have no maker rights there.
- The solution's source is in the application's Git repository, through the platform's Git integration or the CLI (`pac solution clone`, `pac solution sync`). That is the system of record ([OWN-05](../../enterprise-architecture/principles/ownership.md#own-05-the-repository-is-the-system-of-record)); an environment is just where it runs. Agents change what the source format supports well (formulas, settings, flows, tables); layout is changed in Power Apps Studio and synced back before anything else changes.
- The pipeline builds a **managed** solution from the repository (`pac solution pack --packagetype Managed`), checks that it is managed, and imports that into test and production. Nobody exports a solution by hand from a maker's environment.

**Why.** "It's in my environment" is the Power Apps version of "it works on my machine", plus no history, no review and no way back. Managed solutions from source control make Power Apps changes as reviewable, testable and reversible as any other code.
**Verified by.** `test`: environment roles and security groups, checked daily by Central IT's platform tooling; the pipeline builds and imports only managed solutions from the repository.

### PA-06: Whose identity each connection uses
**Rule.**
- **Interactive data access uses the user's own, delegated identity**: the app reads and writes SharePoint or Dataverse as the person using it, so PA-02's permissions apply.
- **Unattended automation** (scheduled or event-triggered flows) uses a non-personal identity that Central IT manages, with the minimum permissions for its job, documented in a decision record. Never a person's account.
- **Connection references** bind connections to each environment at deployment; **environment variables** carry everything else that differs between environments. Neither decides who may do what: authorization stays with the identity and the data source.

**Why.** Personal connections break the day their owner leaves ([OWN-02](../../enterprise-architecture/principles/ownership.md#own-02-no-owner-means-decommission)), usually silently. And an app that acts with one person's access on behalf of everyone has quietly bypassed PA-02.
**Verified by.** `test`: the solution contains only connection references, and no connection owned by a person in test or production. `review`: the decision record for every non-user identity.

### PA-07: Flows don't lend out privileges
**Rule.** A flow runs with the permissions of its connections. For every flow, the repository declares its trigger, how the trigger is authenticated, who may call it, which identity it runs as, and who owns it.

- Flows that users can trigger act **as the user**, unless the extra privilege is the explicit purpose of the flow. Then the flow **authorizes the specific request itself**: it checks who is calling and that they may act on *that* record. It never trusts a record ID or a role sent by the app.
- No HTTP-triggered flow accepts anonymous calls.
- Inputs and outputs that contain Confidential data are marked secure, so they don't appear in run history.

**Why.** A flow with an administrator's connection behind a button is privilege escalation with a friendly interface. Anyone who can call it directly, with a changed record ID, gets the administrator's reach.
**Verified by.** `test`: the Test Agent calls each elevated flow directly, as a user without the privilege and with someone else's record ID, and it must refuse. `review`: the flow declarations.

### PA-08: DLP policies are a boundary, not an authorization
**Rule.** Connector policies decide which connectors an app may use. They are generated from [approved-connectors.yaml](approved-connectors.yaml), by connector ID:

- **Every environment is a Managed Environment**, including makers' development environments; apps aren't built in the tenant's default environment. Each has an **advanced connector policy**: an allowlist of exactly the connectors under `allowed`. Everything else is unavailable, including connectors Microsoft adds later. On a Managed Environment, this also covers the Microsoft 365 connectors that classic DLP policies can't block (OneDrive for Business, Excel Online, Planner, Power BI and others).
- **Alongside it, a classic DLP policy** covers what advanced connector policies don't cover yet. **Custom connectors** are classified by host: NATAX API hosts are Business, and everything else is Blocked. The **HTTP connectors** are Blocked.
- **Where a maker portal doesn't yet enforce the advanced policy while an app is being built**, the pipeline's check is the control. The app's declared connectors must all be allowed, and so must the connection references in its solution.
- Connector policies decide *which connectors*, not *which destinations* or *which records*. Destinations are controlled where they live:
  - SharePoint and OneDrive external sharing is off.
  - Mail flow rules stop these identities from emailing customers. Email to customers goes through notification-service ([INT-05](../../enterprise-architecture/principles/integration.md#int-05-shared-capabilities-are-used-not-rebuilt)).
  - Tenant isolation blocks connections to other tenants.

  Records are controlled by PA-02.

**Why.** Without connector policies, any app can copy NATAX data to any of hundreds of connectors. Classic DLP alone can't keep that promise: about twenty Microsoft 365 connectors can't be blocked by it. They become "Non-Business", which still lets an app combine them. An architecture that says "everything else is blocked" on classic DLP describes a control that doesn't exist. Even an allowed connector can still reach the wrong place, so a connector policy is one boundary among several, never the only one.
**Verified by.** `test`:
- The app's declared connectors are checked against the allowlist (check-dependencies).
- The tenant's policies and environment settings are checked against [approved-connectors.yaml](approved-connectors.yaml) every day ([DEL-04](../../enterprise-architecture/principles/delivery.md#del-04-infrastructure-and-network-are-code)).
- The Security Agent's sweeps look for apps that use connectors outside the list.

### PA-09: NATAX systems only through their APIs, as the signed-in user
**Rule.** Power Apps reach NATAX systems only through **custom connectors** to their published APIs, never through a direct database connection.

- **The user's own token.** A custom connector authenticates with **OAuth 2.0 through Microsoft Entra ID, as the signed-in user**. The API validates the token and authorizes the user as it would any other caller ([IAM-04](../../enterprise-architecture/principles/identity-and-access.md#iam-04-authorization-is-explicit-server-side-and-deny-by-default)).
- **The Power Platform's own network.** The connector reaches the API through the Power Platform's **virtual network support**: a subnet in NATAX's Azure subscription, delegated to the Power Platform, and connected to DC1 and DC2 over ExpressRoute.
  - In the [landscape](../../enterprise-architecture/landscape/landscape.yaml), that subnet is the zone `power-platform`.
  - An API that Power Apps may call lists `zone:power-platform` as a consumer, with its provider's consent ([INT-06](../../enterprise-architecture/principles/integration.md#int-06-dont-break-consumers-and-onboard-them-without-ceremony)). Like any internal application, it is reached through platform-lb.
  - The Power Platform accepts only certificates with a complete public chain, so such an API also has a certificate from a public CA, for its name under `natax.example`.
- **No on-premises data gateway.** Custom connectors through the gateway don't support OAuth; the only way to send a user's identity through it is Windows authentication, with each user typing their password into a connection ([IAM-02](../../enterprise-architecture/principles/identity-and-access.md#iam-02-applications-dont-handle-passwords)). And the gateway's outbound relay, `*.servicebus.windows.net`, would let a host inside NATAX reach any Azure Relay namespace, including one an attacker owns.

**Why.** A network path says *which network* may connect, not *who* is calling. Without the user's own token, every Power App would reach the API with the reach of whatever connected on its behalf.
**Verified by.** `test`:
- The API's tests refuse calls without a valid user token, and calls from a user who lacks the role.
- The network policy and its expectations cover `zone:power-platform`: it reaches only the APIs that list it, and never a database.
- `approved-connectors.yaml` has no gateway connectors, and the landscape has no gateway.

### PA-10: Staff only, shared with groups
**Rule.**
- Apps are shared only with the Entra security groups that grant the app's roles ([IAM-04](../../enterprise-architecture/principles/identity-and-access.md#iam-04-authorization-is-explicit-server-side-and-deny-by-default)), and the same groups get their permissions on the data (PA-02). Never with individuals, and never with "Everyone".
- Sharing in test and production is done by the pipeline's deployment identity, from `architecture.yaml`. Makers have no sharing rights there. After each deployment and daily, the pipeline compares the app's actual assignments with the approved groups and removes anything else.
- Guest (B2B) access to the Power Platform environments and to the apps' SharePoint sites is off, and the role groups contain only workforce accounts.
- The Problem Owner reviews group membership every 90 days.

**Why.** Sharing with individuals can't be reviewed or cleaned up, sharing with everyone shares the data with everyone (PA-02), and an Entra group can quietly contain a guest. The platform's own sharing limits can stop sharing with groups, but can't require it, so the pipeline enforces it.
**Verified by.** `test`: the daily comparison of assignments and group membership.

### PA-11: Formulas are code, and invariants live on the server
**Rule.** Logic is written once, as named formulas, components or component libraries, not copied between screens. Rules that must always hold (required fields, allowed values, consistency between fields) are enforced where direct API callers can't skip them: SharePoint column validation, Dataverse column types and table-scoped business rules, or server-side logic for anything more. A rule enforced only in the app, or in a model-driven form, isn't enforced.
**Why.** Power Fx is a programming language, and the usual rules apply: copied code diverges. And for the same reason as PA-02, checks that exist only in the user interface can be bypassed.
**Verified by.** `review`; `test`: the Test Agent writes invalid data directly to the data source, and it must be refused.

### PA-12: Tests run without a person clicking
**Rule.** Every app has automated tests, written by the Test Agent, in the repository's `tests/` folder, in TypeScript with Playwright, run by the pipeline:

- **App tests** with Playwright, following Microsoft's Power Platform Playwright guidance, covering each requirement. (Power Apps Test Engine was deprecated in 2026; it isn't used.)
- **Permission tests against the data source** (PA-02, PA-07, PA-11): as test users in each role, in several roles and in none, read and change the list or table *directly*, through its API, and call elevated flows directly. Anything the role may not do must fail.
- **Delegation tests** (PA-04), with synthetic data generated above the delegation limit.

Test data is synthetic ([DAT-04](../../enterprise-architecture/principles/data.md#dat-04-non-production-environments-use-synthetic-data-only)), loaded into the test environment by a script in the repository. The test users' credentials come from the secret store.
**Why.** "I tried it and it worked" is not a test, and tests through the app can't show that the data is safe without the app.
**Verified by.** `test`: the pipeline runs them.

### PA-13: The solution checker has nothing serious to say
**Rule.** The pipeline runs the solution checker on the managed solution of every release candidate, and reads its results: any finding rated High or Critical blocks the release.
**Why.** It's the platform's own static analysis, and it costs nothing to run.
**Verified by.** `test`.

### PA-14: Every app is owned by more than one person, and nothing lives outside the landscape
**Rule.** Registration follows [OWN-08](../../enterprise-architecture/principles/ownership.md#own-08-every-application-is-in-the-landscape). On this platform, the pipeline also makes a co-owner group an owner of every app and flow, so nothing is owned by one person alone. Every week, the tenant's inventory of apps, flows and Power Pages sites is compared with the landscape: anything found outside it gets 30 days to be registered or is removed, and a Power Pages site is removed.
**Why.** Power Apps sprawl is real: hundreds of apps nobody remembers building, each with its own copy of somebody's data. [Look before you build](../../enterprise-architecture/principles/simplicity.md#sim-09-look-before-you-build) only works if the landscape is complete.
**Verified by.** `test`: the weekly inventory comparison; the pipeline assigns the co-owner group.

### PA-15: Audit and retention live with the data
**Rule.** `architecture.yaml` lists the audited actions ([IAM-07](../../enterprise-architecture/principles/identity-and-access.md#iam-07-every-action-on-sensitive-data-is-attributable)), and each is covered by a mechanism that actually records it:

- **Changes:** Dataverse auditing for the app's tables, or SharePoint version history together with the tenant's audit log.
- **Reads and exports** of Confidential data, where they must be attributable: Dataverse's activity logging for reads (which has its own prerequisites), or the tenant's audit log for SharePoint access. Ordinary Dataverse auditing records changes, not reads.
- Audit records are kept for seven years ([DAT-05](../../enterprise-architecture/principles/data.md#dat-05-retention-is-defined-and-automated)), exported to the central log store where the platform's own retention is shorter.

Data retention is applied by the data source (retention labels on the list, bulk-delete jobs in Dataverse), as declared in `architecture.yaml`.
**Why.** The app is a window on the data. Attribution and retention belong where the data lives, and "auditing is on" isn't the same as "the action that matters is recorded".
**Verified by.** `test`: the Test Agent performs each audited action and finds its audit record. Auditing and retention configuration is checked when the solution is imported.
