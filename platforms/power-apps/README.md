# Power Apps

The architecture for applications on Microsoft's Power Platform: canvas and model-driven Power Apps, the Power Automate flows that belong to them, and their data in Dataverse or SharePoint lists.

It's the quickest way for a team to solve a list-form-approval problem, and the Problem Owner can see and change the result themselves. It is also where enterprises accumulate hundreds of unowned apps with copies of each other's data. The rules here keep the first and prevent the second.

Version: [VERSION](VERSION). Limits: [platform.yaml](platform.yaml). Governed by the [central architecture](../../enterprise-architecture/README.md), and the always-applied [network](../../network/README.md) and [infrastructure](../../infrastructure/README.md) architectures.

## In one minute

- **For:** forms, lists and simple workflows for staff, with data in Microsoft 365.
- **Not for:** customers, guests, class A, Taxpayer-Restricted data, or anything that must keep working when Microsoft 365 is down ([PA-01](standards.md#pa-01-microsoft-365s-availability-is-accepted-once-by-the-board)).
- **Security is on the data, not in the app** ([PA-02](standards.md#pa-02-security-is-enforced-at-the-data-source-never-in-the-app)). Everyone who can use the app can open its SharePoint list or Dataverse table directly.
- **Queries must be delegable**, or they silently return wrong answers once the data grows ([PA-04](standards.md#pa-04-queries-are-delegable-or-they-are-wrong)).
- **Solutions in Git, managed solutions in production, imported only by the pipeline** ([PA-05](standards.md#pa-05-environments-and-the-pipeline-as-the-only-way-into-production)).
- **Users act as themselves; flows don't lend out privileges** ([PA-06](standards.md#pa-06-whose-identity-each-connection-uses), [PA-07](standards.md#pa-07-flows-dont-lend-out-privileges)).
- **DLP policies are a boundary, not an authorization**; NATAX systems only through the data gateway, as the signed-in user ([PA-08](standards.md#pa-08-dlp-policies-are-a-boundary-not-an-authorization), [PA-09](standards.md#pa-09-natax-systems-only-through-the-data-gateway-with-real-authentication)).

## What's here

| | |
|---|---|
| [standards.md](standards.md) | The rules for this platform (PA-xx) |
| [platform.yaml](platform.yaml) | The limits the pipeline enforces |
| [approved-connectors.yaml](approved-connectors.yaml) | Connector classification, from which the DLP policies are generated |
| [BOOTSTRAP.md](BOOTSTRAP.md) | Setting up to build a Power App |
| [agents/](agents/README.md) | What the agents do differently on this platform |
| [template/](template/) | The repository layout for a Power Apps solution |

## What isn't runnable here

This repository doesn't contain a Power Platform tenant. The rules, the limits in `platform.yaml` and the manifest checks are real and enforced. The platform checks (the solution checker, the Playwright tests) run wherever the Power Platform CLI and a tenant are available, and the pipeline reports them as skipped elsewhere, never as passed. A skipped check leaves the pipeline's result incomplete, which blocks a release like a failure.
