# Anti-patterns

The rules say what must hold. This page shows what breaking them usually looks like, so that an agent, or a person, recognizes it in a diff and knows the way out. Platform-specific anti-patterns are in each platform's folder: [TypeScript](../platforms/typescript-web/anti-patterns.md), [Power Apps](../platforms/power-apps/anti-patterns.md), [Android](../platforms/android/anti-patterns.md).

How this catalog works:

- **Examples, not the boundary.** Each anti-pattern is a common way of breaking a rule. A candidate that breaks the rule in a way nobody listed still breaks the rule. The Governance Agent judges the rule, and uses this page to recognize it sooner and explain it better.
- **Every anti-pattern breaks a rule.** Each entry cites the rule it breaks. One that breaks no rule would be a rule by the back door: it goes to the Board as a [proposal](templates/architecture-proposal.md) instead.
- **Only what needs judgment.** If an anti-pattern can be recognized mechanically, it becomes a deterministic check ([AGT-10](principles/ai-agents.md#agt-10-deterministic-where-it-must-be)) and leaves this page. Hardcoded secrets and unpinned versions are checks, not entries here.
- **Each one is tested.** Every entry has a sample candidate in the Governance Agent's [regression set](pipeline/regression/README.md). A model is pinned only if it rejects every one of them, citing the right rule ([AGT-11](principles/ai-agents.md#agt-11-the-ai-providers-are-governed-like-any-other-dependency)).
- **Harvested from evidence.** When the same finding appears in several verdicts, reviews or escalations, the Board adds it here, with its sample ([architecture review](governance/architecture-review.md)).

Each entry has four parts: what it **looks like** in a diff, **why it hurts**, the rule it **breaks**, and what to do **instead**. The last part is the path forward a rejection gives.

### AP-01: Security by hiding
**Looks like.** The user interface leaves out a button, a column or other people's records, and that is the only thing between a user and the data: the API, the database grants or the data source would hand it over to anyone who asks directly.
**Why it hurts.** Anyone can ask directly: a browser's developer tools, a direct API call, an export to Excel. Hiding decides what is convenient, not what is allowed.
**Breaks.** [IAM-04](principles/identity-and-access.md#iam-04-authorization-is-explicit-server-side-and-deny-by-default).
**Instead.** Authorize every request on the server, or at the data source, as if the interface didn't exist. Then hide what the user may not use, for convenience.

### AP-02: The health check that proves nothing
**Looks like.** A load balancer or monitor that checks whether a port is open, a TLS handshake works, or `/` answers. The readiness endpoint returns 200 without looking at anything.
**Why it hurts.** The instance stays in rotation while it can't reach its database, and every request it gets fails. That is how a deadline day loses 47 minutes.
**Breaks.** [RES-06](principles/resilience.md#res-06-healthy-means-ready-to-serve).
**Instead.** A readiness endpoint that checks exactly the critical dependencies, quickly, and a check that asks for it and requires 200.

### AP-03: The health check that becomes the outage
**Looks like.** Readiness that opens a new database connection on every call, checks every dependency in depth, or can be called by anyone, as often as they like. Or readiness that fails under load, taking every busy instance out of rotation at once.
**Why it hurts.** A burst of readiness calls exhausts the database's connections, and then readiness fails on healthy instances, and the whole fleet is withdrawn. The check causes the failure it was meant to detect.
**Breaks.** [RES-06](principles/resilience.md#res-06-healthy-means-ready-to-serve), [RES-08](principles/resilience.md#res-08-everything-is-bounded).
**Instead.** One reused connection per instance, a short timeout, a cached result shared by concurrent callers, and health endpoints closed to clients at the load balancer. Busy is not unhealthy.

### AP-04: Authorizing on names
**Looks like.** Access decided by a group's display name, an email domain, a job title, or a string a user can choose: `if (groups.includes('finance-admins'))`.
**Why it hurts.** Names aren't unique, and anyone who can create a group or change a profile can choose one. Entra ID doesn't even send group names; code written for names grants nothing, or the wrong thing once someone "fixes" it.
**Breaks.** [IAM-04](principles/identity-and-access.md#iam-04-authorization-is-explicit-server-side-and-deny-by-default).
**Instead.** App roles defined in the application's registration, assigned to groups in the IdP, and read from the token's `roles` claim.

### AP-05: Check first, normalize later
**Looks like.** Input is validated, and then decoded, resolved or normalized: a redirect target checked before the URL parser resolves `/.//evil.example`, a path checked before `..` is resolved, a value checked before it is unescaped.
**Why it hurts.** What was checked isn't what is used. `/.//evil.example` passes "starts with one slash", and the browser receives `//evil.example`: another site.
**Breaks.** [SEC-06](principles/security.md#sec-06-all-input-is-hostile).
**Instead.** Normalize first, then check what will actually be used, and build the output from the checked form.

### AP-06: The checker that shares the producer's mind
**Looks like.** A verifier that reads the generator's intent, or its internal structures, instead of what it produced; or a drift check that compares the output with a fresh run of the same generator.
**Why it hurts.** A bug in the generator passes every check, because the check asks the generator what it meant. A renderer that writes `watchdog: off` would still be green.
**Breaks.** [DEL-06](principles/delivery.md#del-06-checks-verify-the-output-not-the-intent-that-produced-it).
**Instead.** Read the output back, with a reader whose grammar refuses what it doesn't know, and let the real software be the authority. Ship every checker with the mutations it must catch.

### AP-07: Believing the candidate
**Looks like.** The pipeline takes the candidate's word for something it must know independently: the test counts it prints, a review file it wrote, a `models:` field, a summary written by the agent asking for approval, an "isolated" flag nobody checked.
**Why it hurts.** Code that can fail a test can also report that it passed. Anything the candidate controls is a claim.
**Breaks.** [SEC-13](principles/security.md#sec-13-the-pipeline-treats-every-release-candidate-as-hostile), [AGT-01](principles/ai-agents.md#agt-01-separate-agents-for-separate-duties).
**Instead.** Decide what must hold against a malicious candidate outside its code: from the architecture, the probes, the authorities, the Security Agent. Label the candidate's own output as its claims.

### AP-08: The blanket exception
**Looks like.** An exception that covers a whole rule, has no end date or a renewal every year, or is the same exception granted to several applications.
**Why it hurts.** It covers findings nobody has seen yet, outlives its reason, and hides an architecture that doesn't fit. Exceptions accumulate until the architecture describes an environment that no longer exists.
**Breaks.** [SIM-07](principles/simplicity.md#sim-07-temporary-complexity-has-an-owner-and-an-end-date).
**Instead.** An exception for one finding, with an owner, compensating controls and at most 12 months. The same exception twice means the architecture should change: a proposal, not another exception.

### AP-09: The convenient hop
**Looks like.** A jump host, a bastion, a shared admin box, or a service that "just needs" port 22 to other hosts, so administrators and scripts can get everywhere through one place.
**Why it hurts.** Whoever takes over the hop sees every credential that passes through it, and reaches everything it reaches.
**Breaks.** [IAM-06](principles/identity-and-access.md#iam-06-human-administrative-access-is-just-in-time-and-direct).
**Instead.** Just-in-time access from a privileged access workstation, directly to the target, with short-lived certificates.

### AP-10: The wildcard way out
**Looks like.** An egress destination with a wildcard (`*.somecloud.net`), any port, or "the internet" for a service that calls one API.
**Why it hurts.** Anything under the wildcard is reachable, including a namespace an attacker registers. It is an exfiltration channel with an approval stamp.
**Breaks.** [INT-05](principles/integration.md#int-05-shared-capabilities-are-used-not-rebuilt), [SEC-02](principles/security.md#sec-02-nothing-is-trusted-because-of-where-it-is).
**Instead.** The exact destinations, through the egress proxy. Where a provider truly requires a wildcard, a recorded reason and a narrower design first.

### AP-11: The copy that becomes the source
**Looks like.** An application keeps its own copy of another system's records "for speed", then starts correcting or extending them, or other applications start reading the copy.
**Why it hurts.** Two truths. They drift apart, and nobody knows which one a decision was based on.
**Breaks.** [DAT-03](principles/data.md#dat-03-one-system-of-record-per-entity).
**Instead.** Read from the system of record through its API. If a copy is needed, declare it as a derived copy, read-only, refreshed from the source, and keep only what the purpose needs.

### AP-12: "Couldn't check" counted as "fine"
**Looks like.** A skipped test, a timeout, a missing tool, an unreadable file or a probe without evidence treated as a pass: an exit code 0 with "SKIPPED" in the log.
**Why it hurts.** Absence of evidence becomes evidence of compliance. Automation reads exit codes, not logs.
**Breaks.** [DEL-06](principles/delivery.md#del-06-checks-verify-the-output-not-the-intent-that-produced-it), [ZTN-06](../network/standards.md#ztn-06-tests-are-deterministic-and-there-are-three-kinds).
**Instead.** Three outcomes: pass, fail, incomplete. Only pass lets a gate pass, and every command's exit code says which.

### AP-13: Trusted because it's inside
**Looks like.** "It's on the internal network", "it comes from the VPN", "it's a managed device", used as the reason a request is allowed, with no identity checked.
**Why it hurts.** Every attacker who gets inside, one phished laptop or one compromised service, is trusted too.
**Breaks.** [SEC-02](principles/security.md#sec-02-nothing-is-trusted-because-of-where-it-is).
**Instead.** Authorize every connection by the identities, services and resources involved; the network only narrows who can try.

### AP-14: The datacenter that looks alive
**Looks like.** A global DNS monitor or failover check that probes a VIP whose backends include the other datacenter as backup, or a check that any instance anywhere answers.
**Why it hurts.** When one datacenter's instances are dead, the other datacenter answers for it, so the site is never withdrawn, and its users get slow or failing requests instead of being sent elsewhere.
**Breaks.** [RES-02](principles/resilience.md#res-02-dc1-and-dc2-are-both-production-all-the-time), [RES-06](principles/resilience.md#res-06-healthy-means-ready-to-serve).
**Instead.** Judge each datacenter by its own instances, directly, and withdraw it when none of them is ready.

### AP-15: The reason that isn't one
**Looks like.** A request whose Why is "because I want it", "the director asked for it", "needed", "everyone does it", or the request again in other words.
**Why it hurts.** Nobody can use it to choose between two ways of building the request, to resolve a conflict with another request, or to tell later whether it still holds. The drift review can only check the letter.
**Breaks.** [AGT-12](principles/ai-agents.md#agt-12-intent-stays-in-force-until-it-is-withdrawn).
**Instead.** Ask what it is for: who benefits, what problem it solves, what goes wrong without it. If the Problem Owner doesn't know yet, record their words and an open question. A fix that names what it remedies ("to remedy the bug introduced by version 2.3.1") is a reason.
