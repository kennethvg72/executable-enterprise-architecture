# Anti-patterns: Power Apps

Recognizable ways of breaking the [Power Apps standards](standards.md), with the way out. They add to the [central catalog](../../enterprise-architecture/anti-patterns.md), and work the same way: examples, not the boundary; every entry breaks a rule; each has a sample candidate in the [regression set](../../enterprise-architecture/pipeline/regression/README.md).

### AP-PA-01: Filtering the gallery
**Looks like.** `Filter(Expenses, Owner.Email = User().Email)` in the app, and a SharePoint list or Dataverse table that every user of the app can read in full.
**Why it hurts.** The list opens in the browser, exports to Excel and answers the Graph API. The filter decides what is shown, not what can be read.
**Breaks.** [PA-02](standards.md#pa-02-security-is-enforced-at-the-data-source-never-in-the-app).
**Instead.** Permissions on the data: Dataverse security roles and row ownership, or separate SharePoint lists per audience. Then filter for convenience.

### AP-PA-02: The flow that lends its maker's rights
**Looks like.** An instant flow, triggered from the app, that uses its maker's connection to read or change data the user couldn't, and trusts the record ID the app sends.
**Why it hurts.** Anyone who can trigger the flow, with any record ID, gets the maker's rights. The app's checks don't apply to a direct call.
**Breaks.** [PA-07](standards.md#pa-07-flows-dont-lend-out-privileges).
**Instead.** Flows run as the user wherever possible. A flow that must act with more rights checks, inside the flow, that this user may make this request for this record.

### AP-PA-03: "That connector is blocked"
**Looks like.** A design that relies on a classic DLP policy to keep data from OneDrive for Business, Excel Online, Planner or another Microsoft 365 connector that classic DLP can't block.
**Why it hurts.** Those connectors become "Non-Business", not blocked, and an app can still combine them. The control the design counts on doesn't exist.
**Breaks.** [PA-08](standards.md#pa-08-dlp-policies-are-a-boundary-not-an-authorization).
**Instead.** Managed Environments with an advanced connector policy that allows exactly the approved connectors, and data permissions that hold even if a connector is allowed.

### AP-PA-04: Ignoring the delegation warning
**Looks like.** A blue underline in Power Apps Studio, and a search, filter or count over a list that will grow past the row limit.
**Why it hurts.** It works in testing, with 50 rows, and silently returns wrong answers in production, with 5,000.
**Breaks.** [PA-04](standards.md#pa-04-queries-are-delegable-or-they-are-wrong).
**Instead.** Delegable queries, or a data design that makes them possible; test with synthetic data above the limit.

### AP-PA-05: Shared with a person
**Looks like.** An app or flow shared with named individuals, with "Everyone", or with a guest.
**Why it hurts.** Nobody reviews who has it, leavers keep it, and "Everyone" includes people the Problem Owner never meant.
**Breaks.** [PA-10](standards.md#pa-10-staff-only-shared-with-groups).
**Instead.** Share with the security groups for the app's roles, and nothing else.
