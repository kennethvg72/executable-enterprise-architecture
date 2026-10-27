# Agents on the Power Apps platform

These add to the [central role definitions](../../../enterprise-architecture/agents/README.md).

## Development Agent

- **Design the data first.** Before any screen: the tables or lists, who may read and change which rows and columns, and therefore SharePoint or Dataverse ([PA-02](../standards.md#pa-02-security-is-enforced-at-the-data-source-never-in-the-app), [PA-03](../standards.md#pa-03-choose-the-data-store-by-who-may-see-what)). Explain it to the Problem Owner in their terms: *"Everyone who can use this app will be able to open this list and see every column. Is that all right?"*
- **Work on the source, in the repository**, where the source format supports it well: formulas, settings, flows, tables. Layout is changed in Power Apps Studio (by you or the Problem Owner) and synced back into the repository before anything else changes ([PA-05](../standards.md#pa-05-environments-and-the-pipeline-as-the-only-way-into-production)). The repository is the system of record; the environment isn't.
- **Users act as themselves** ([PA-06](../standards.md#pa-06-whose-identity-each-connection-uses)). Every connection is a connection reference, every setting an environment variable, and every flow declares its trigger, who may call it and whose permissions it runs with ([PA-07](../standards.md#pa-07-flows-dont-lend-out-privileges)).
- **Delegation warnings are bugs** ([PA-04](../standards.md#pa-04-queries-are-delegable-or-they-are-wrong)). Fix the query or the data design; never raise the row limit and hope.
- **Only approved connectors** ([approved-connectors.yaml](../approved-connectors.yaml), [PA-08](../standards.md#pa-08-dlp-policies-are-a-boundary-not-an-authorization)). A NATAX system means a custom connector to its API, with OAuth as the signed-in user, never through the on-premises data gateway, and with the provider's consent ([PA-09](../standards.md#pa-09-natax-systems-only-through-their-apis-as-the-signed-in-user)).

## Test Agent

- Tests the data source **directly**, without the app, as every role, several roles at once, and no role: read, create, change and delete, through the SharePoint or Dataverse API. Everything a role may not do must fail ([PA-12](../standards.md#pa-12-tests-run-without-a-person-clicking)).
- Calls every elevated flow directly, as a user without the privilege and with someone else's record ID ([PA-07](../standards.md#pa-07-flows-dont-lend-out-privileges)).
- Generates synthetic data **above the delegation limit**, and checks that searches, filters and counts are still right.
- Writes Playwright tests for each requirement, and checks every audited action leaves an audit record ([PA-15](../standards.md#pa-15-audit-and-retention-live-with-the-data)).
- Records the evidence [platform.yaml](../platform.yaml) names, with `record-evidence.ts`, on the committed code: `solution-check` and `test-results`. Their output isn't counted, so the audit checks the command, the commit and the exit code ([DEL-02](../../../enterprise-architecture/principles/delivery.md#del-02-tests-are-part-of-the-change)).

## Local Governance Agent

Before "Go": is this really a Power App (limits in [platform.yaml](../platform.yaml))? Is the data store chosen by who may see what? Does anything here already exist in the [landscape](../../../enterprise-architecture/landscape/landscape.md)? Before "Release": data-source permissions match the roles; no personal connections; every elevated flow authorizes its requests; no unapproved connectors; the solution checker has no High or Critical findings; the Playwright and permission tests pass; the app is shared with groups only.

## Security Agent

The review playbook for this platform, written by NATAX's security specialists. It adds to the [central Security Agent role](../../../enterprise-architecture/agents/security-agent.md). You read the solution's source and the Test Agent's tests; you run nothing. An attack without its test is a finding.

- **Around the app.** The SharePoint list or Dataverse table's own permissions, against every role: what each role could read and change directly, in the browser, exported to Excel, through the Graph API and the Dataverse Web API, including the columns the app hides ([PA-02](../standards.md#pa-02-security-is-enforced-at-the-data-source-never-in-the-app)).
- **A flow's privileges.** Every flow's trigger, who may call it and whose permissions it runs with: what a user without the privilege, with someone else's record or with values the app would never send could make it do ([PA-07](../standards.md#pa-07-flows-dont-lend-out-privileges)). Secure inputs and outputs hide what they should from the run history.
- **Through the custom connectors.** The NATAX APIs each custom connector declares, and whether it could reach others. Only the declared ones may answer, and only with the signed-in user's permissions ([PA-09](../standards.md#pa-09-natax-systems-only-through-their-apis-as-the-signed-in-user)).
- **Who can open it.** The app, its flows and its data are shared with security groups only, and not with individuals, guests or the whole organization ([PA-10](../standards.md#pa-10-staff-only-shared-with-groups)).
