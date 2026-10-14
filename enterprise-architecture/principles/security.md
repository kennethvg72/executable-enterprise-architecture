# Security (SEC)

NATAX holds what people least want leaked: their income, their family situation, their bank details and their taxpayer identifiers. Security isn't a feature of some applications. It's a property of the whole landscape, and the landscape is only as strong as its weakest path.

Related: [identity and access](identity-and-access.md), [data](data.md), and the [network](../../network/README.md) architecture.

### SEC-01: Only the central pipeline changes production
**Rule.** No person, local agent or application team has standing administrative or deployment access to production: not to servers, databases, network devices, load balancers, DNS or secrets. Every production change, including configuration and data fixes, is made by the [central pipeline](../pipeline/README.md). Just-in-time human access follows [IAM-06](identity-and-access.md#iam-06-human-administrative-access-is-just-in-time-and-direct). (Runtime access is different: applications' workload identities and users' sessions use production as designed.)
**Why.** If a change can bypass the pipeline, the pipeline's controls are advisory. It also means the Problem Owner never needs production rights, and can't be pressured into misusing them.
**Verified by.** `test`: administrative and deployment grants in production are compared with the pipeline's identities and the active just-in-time grants daily. Any other standing grant is an incident.

### SEC-02: Nothing is trusted because of where it is
**Rule.** Every connection is authorized by the identities of the service, workload or person at both ends, and by an explicit policy. Being inside a datacenter, on the corporate network or on the VPN grants nothing. The network denies everything that isn't explicitly allowed.
**Why.** Broad network access means one compromised host reaches everything. "Internal" is not a security property.
**Verified by.** `test`: the [network](../../network/README.md) policy is compiled from declared intent and verified by deterministic tests.

### SEC-03: Secrets never live in repositories
**Rule.** Passwords, keys, tokens and certificates' private keys are never stored in repositories, container images, build artifacts, logs or files on developer machines that get committed. Workloads receive secrets at runtime from the central secret store, using their workload identity. Secrets are rotated automatically; a secret that can't be rotated is a defect.
**Why.** Repositories are copied, forked, cached and indexed. Anything in one should be assumed public eventually.
**Verified by.** `test`: secret scanning on every release candidate. A finding blocks the release, and the secret is treated as compromised and rotated, even if the commit is removed.

### SEC-04: Encrypt everything in transit
**Rule.** All network traffic is encrypted: TLS 1.3 between NATAX systems, including database connections, replication and consensus traffic; SSH for administration. The internet edge also accepts TLS 1.2 with forward-secret AEAD ciphers, for customers' older devices. Legacy systems that can't do TLS 1.3 internally are listed in the [landscape](../landscape/accumulated-complexity.md) with a removal date. Load balancers that terminate TLS re-encrypt to the backend. Data classified *Confidential* or higher is also encrypted at rest.
**Why.** Encryption is cheap. Proving that an internal network segment can never be observed is not.
**Verified by.** `test`: configuration checks on load balancers, database and service configuration.

### SEC-05: Dependencies are pinned, sourced and scanned
**Rule.** Every dependency is pinned to an exact version with a lockfile, comes from a NATAX-approved registry mirror, and is scanned for known vulnerabilities on every release candidate and daily in production. Findings are handled under [SEC-08](#sec-08-security-findings-have-deadlines-not-opinions).
**Why.** Most of what runs is code that NATAX didn't write. SIM-01 keeps the amount of it small; this rule keeps it under control.
**Verified by.** `test`.

### SEC-06: All input is hostile
**Rule.** Applications validate every input at the boundary (type, size, format, allowed values), encode every output for its context (HTML, SQL, shell, URL), and use parameterized queries only. Input from other NATAX services is validated too.
**Why.** Injection remains the most reliable way into an application. Another internal service may itself be compromised or simply wrong.
**Verified by.** `test`: static analysis and the Test Agent's attack tests. `review`.

### SEC-07: Test environments can't reach production
**Rule.** Development, test and acceptance environments are isolated from production by network policy and identity. They have no route to production services or data, and production identities aren't valid in them. They use only synthetic data ([DAT-04](data.md#dat-04-non-production-environments-use-synthetic-data-only)).
**Why.** Test environments are where experiments happen, controls are relaxed and unreviewed code runs. They must not be a bridge into production.
**Verified by.** `test`: probes from test and acceptance networks to production must fail.

### SEC-08: Security findings have deadlines, not opinions
**Rule.** Findings are rated with CVSS, adjusted for actual reachability. *Critical*: blocks release, and in production is fixed or mitigated within 24 hours. *High*: fixed within 14 days. *Medium*: fixed within 90 days. *Low*: fixed when the code is next changed. *High* and *Critical* findings can never be accepted locally; not fixing one needs a Board exception ([escalation](../governance/escalation.md#findings-risks-and-exceptions)).
**Why.** Without deadlines, findings become a backlog that nobody owns.
**Verified by.** `test`: the pipeline tracks finding age. An application with an overdue finding can only release fixes.

### SEC-09: Least privilege for workloads
**Rule.** Each workload runs with its own identity, its own database role and only the permissions its declared function needs. Workloads never run as root or as the database owner role. Shared service accounts aren't allowed.
**Why.** When a workload is compromised, its privileges are the attacker's privileges.
**Verified by.** `test`: database grants and runtime configuration are checked against the application's `architecture.yaml`.

### SEC-10: Never build your own security primitives
**Rule.** Applications use mature, widely-used implementations for cryptography, authentication protocols, session handling and password hashing. They never implement their own. (See [SIM-03](simplicity.md#sim-03-decide-build-versus-buy-on-todays-economics).)
**Why.** Security code fails silently and in ways that tests written by its author won't find.
**Verified by.** `review`.

### SEC-11: Contain the tools, including the AI ones
**Rule.** Build tools, test tools and AI agents in development environments run with write access limited to the workspace they are working in, and no access to credentials beyond what the task needs. Agents run commands inside a sandbox where the platform supports it.

The central pipeline is held to the same rule, more strictly. It runs code from release candidates (their tests, their build scripts) in disposable, unprivileged runners with no production credentials, restricted network egress, read-only access to the architecture and landscape, and a controlled way to export results. The candidate's code never runs where verdicts are written or where deployment credentials live.
**Why.** Dependencies and agents execute code. A malicious package or a manipulated agent must not be able to reach the developer's credentials or files outside the project, and a malicious release candidate must not be able to approve itself.
**Verified by.** `review`: bootstrap procedures configure the sandbox and verify it works. `test`: the pipeline's runner configuration is checked like any other infrastructure.

### SEC-12: Security is tested by someone who didn't build it
**Rule.** Before production, the central [Security Agent](../agents/security-agent.md) attacks every release candidate whose impact requires it ([change-impact.md](../pipeline/change-impact.md#the-security-agent)), in acceptance, using attack playbooks written by NATAX's security specialists for each platform. It also attacks the landscape whenever threats change, and at least monthly. Its findings are judged like any other security finding ([SEC-08](#sec-08-security-findings-have-deadlines-not-opinions)).
**Why.** The Test Agent tries to break what its team built, in the team's environment, with the team's idea of what could go wrong. An attacker has none of those limits. And threats change when applications don't: a weakness found in one application today may be in ten others that haven't changed for a year.
**Verified by.** `test`: the pipeline requires the Security Agent's report in the candidate's evidence when the impact requires it; the finding tracker shows each sweep's date. `review`: the security specialists review the playbooks with each platform version.
