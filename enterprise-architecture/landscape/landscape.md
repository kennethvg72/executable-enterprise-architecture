# The landscape: what NATAX already has

Every application NATAX runs, on every platform, with what it's for and who to talk to. Before anyone builds something new, the Development Agent reads this page with the Problem Owner ([SIM-09](../principles/simplicity.md#sim-09-look-before-you-build)). If something here solves the problem, or most of it, the Problem Owner talks to its owner first.

Applications built through the pipeline are registered by it at their first release candidate, as "in development", and kept up to date with every release ([OWN-08](../principles/ownership.md#own-08-every-application-is-in-the-landscape)). Applications that are older than the pipeline, or bought, are registered by Central IT and marked *(Central IT)*. The network and infrastructure details (addresses, interfaces, capacity) are in [landscape.yaml](landscape.yaml).

## How to read an entry

- **For:** what it does, in the words of the people who use it.
- **Not for:** what people sometimes expect from it, but it doesn't do.
- **Status:** in development, in production, contained (kept running, nothing new added), or being moved or retired.
- **Talk to:** the Problem Owner. They decide whether it can be extended.

## Customer-facing

| Application | For | Not for | Users | Platform | Status | Talk to |
|---|---|---|---|---|---|---|
| **filing-web** | Taxpayers prepare and file their returns | Accounting firms (see advisor-portal) | Taxpayers | typescript-web, class A | In production | Tunde Okafor |
| **advisor-portal** *(Central IT)* | Accounting firms file for their clients | Individual taxpayers | Accounting firms | OpenShift, class A | Being moved | Tunde Okafor |
| **customer-idp** | Sign-in for taxpayers and accounting firms | Staff sign-in (workforce IdP) | Customers | typescript-web, class A | In production | Jordan Alvarez |
| **returns-service** | The system of record for tax returns | Anything without a filing reference | Other applications | typescript-web, class A | In production | Tunde Okafor |
| **calc-engine** *(Central IT)* | Calculates tax, for every tax year since it was written | Explaining a calculation to a customer | Other applications | Java, class A | In production | Hanna van Dijk |
| **efile-gateway** | Submits returns to the Tax Authority; receives acknowledgements and rejections | Contacting customers | Other applications | typescript-web, class A | In production | Priya Raman |
| **payments** | Fees and refund transfers | Reporting | Other applications | typescript-web, class A | In production | Robin Cho |

## Internal

| Application | For | Not for | Users | Platform | Status | Talk to |
|---|---|---|---|---|---|---|
| **notification-service** | The only way to email, text or write to customers: templated, audited | Messages to staff | Other applications | typescript-web, class B | In production | Sofia Bergström |
| **support-crm** *(Central IT)* | Customer Support's case management: one case per customer contact, with history, SLAs and call recordings | Grouping or trending e-file rejections; anything per error code | Customer Support (all agents) | SaaS | In production | Maya Brandt |
| **rejection-triage** | Customer Support works through e-file rejections: grouped by error code and tax year, claims, contact attempts, spikes | Case management (support-crm), contacting customers (notification-service) | Customer Support agents and leads | typescript-web, class B | In development | Dana Whitfield |
| **tax-content-admin** *(Central IT)* | The Tax Content team edits the help texts and explanations shown in filing-web, per tax year | Changing calculations (calc-engine) | Tax Content team | OpenShift, class C | Being moved | Hanna van Dijk |
| **form-archive** *(Central IT)* | Staff look up the Tax Authority's forms and instructions for past tax years | Taxpayers' own returns (returns-service) | Customer Support, Tax Content | OpenShift, class C | Being moved | Hanna van Dijk |
| **release-calendar** *(Central IT)* | Who changes what, when; the change freeze around the filing deadline | Incident management | Engineering, Central IT | OpenShift, class C | Being moved | Jordan Alvarez |
| **data-warehouse** *(Central IT)* | Finance reporting | Operational queries; anything taxpayer-level (being changed, see [accumulated-complexity.md](accumulated-complexity.md)) | Four analysts | Self-hosted, class C | In production | Robin Cho |
| **integration-broker** *(Central IT)* | Legacy messaging between three systems | Anything new | Other applications | Self-hosted, class B | Contained | Jordan Alvarez |

## Power Apps

| Application | For | Not for | Users | Data | Status | Talk to |
|---|---|---|---|---|---|---|
| **support-rota** | Shift and break planning for Customer Support, including deadline week | Absence and leave (HR system) | Support team leads | SharePoint list | In production | Maya Brandt |
| **equipment-loans** | Who has which laptop, headset or test phone | Asset accounting | Central IT service desk | SharePoint list | In production | Jordan Alvarez |
| **expense-claims** | Staff submit expenses with receipts; managers approve | Supplier invoices | All staff | Dataverse | In production | Robin Cho |

## SaaS used across NATAX

| Service | For | Talk to |
|---|---|---|
| Microsoft 365 | Email, documents, Teams, SharePoint, Power Platform, workforce sign-in | Jordan Alvarez |
| HR system | People, absence, leave, the workforce directory's source | Lena Fischer |

## Systems of record

Each kind of data has one system of record. Anything else that holds it holds a copy, declared as one ([DAT-03](../principles/data.md#dat-03-one-system-of-record-per-entity)), and the system of record wins when they disagree.

| Data | System of record |
|---|---|
| Tax returns and their filing status | returns-service |
| Acknowledgements and rejections from the Tax Authority | efile-gateway |
| Customers' identities and sign-in | customer-idp |
| Customer contacts and cases | support-crm |
| Payments and refunds | payments |
| Staff, teams and who manages whom | HR system |
| Tax calculations | calc-engine |

## When something comes close

The check is about the problem, not the technology. Two worked examples:

- **"I need to track which customers we called about their rejections."** support-crm tracks customer contacts. Talk to Maya Brandt first: if a case per rejection is good enough, use support-crm. In rejection-triage's case, the conversation established that support-crm can't group by error code or show trends, so the support-crm owner agreed that a separate application makes sense, as long as it doesn't become a second case-management system. That outcome is recorded in rejection-triage's own repository.
- **"I need a deadline-week rota."** support-rota already does this. Use it, or ask Maya Brandt to extend it.
