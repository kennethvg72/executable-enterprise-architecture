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
**Rule.** Every dependency is pinned to an exact version with a lockfile, comes from a NATAX-approved registry mirror, and is scanned for known vulnerabilities on every release candidate and daily in production. That includes container images: pinned to a version tag, or better, a digest, never `latest` or no tag at all. Findings are handled under [SEC-08](#sec-08-security-findings-have-deadlines-not-opinions).
**Why.** Most of what runs is code that NATAX didn't write. SIM-01 keeps the amount of it small; this rule keeps it under control. An image tagged `latest` is whatever the registry serves today: a different image tomorrow, unreviewed and unscanned.
**Verified by.** `test`: [check-images.ts](../tools/check-images.ts) refuses an unpinned image in a compose file, a Dockerfile or a manifest.

### SEC-06: All input is hostile
**Rule.** Applications validate every input at the boundary (type, size, format, allowed values), encode every output for its context (HTML, SQL, shell, URL), and use parameterized queries only. Input from other NATAX services is validated too. Regular expressions from users are bounded: none are accepted where plain text, wildcards or a list of choices will do; where they are accepted, dangerous shapes (a repeated group that holds a repetition) are refused and their length bounded when they are saved, and they run where they can be stopped (a worker with time and memory limits, or an engine that doesn't backtrack), never on the main event loop.
**Why.** Injection remains the most reliable way into an application. Another internal service may itself be compromised or simply wrong. A user's regular expression is a program the user runs on your servers: a backtracking pattern can hold a CPU for hours on input it doesn't match, so one saved filter can take a service down.
**Verified by.** `test`: static analysis and the Test Agent's attack tests, including a known catastrophic pattern (`(a+)+$` against a long line that doesn't match), which must be refused or stopped within its limit. `review`.

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
**Rule.** Build tools, test tools and AI agents in development environments run with write access limited to the workspace they are working in, and no access to credentials beyond what the task needs. Agents run commands inside a sandbox where the platform supports it. The central pipeline is held to a stricter rule of its own ([SEC-13](#sec-13-the-pipeline-treats-every-release-candidate-as-hostile)).
**Why.** Dependencies and agents execute code. A malicious package or a manipulated agent must not be able to reach the developer's credentials or files outside the project.
**Verified by.** `review`: bootstrap procedures configure the sandbox and verify it works, by attempting a write outside the workspace.

### SEC-12: Security is reviewed by someone who didn't build it
**Rule.** Before production, the central [Security Agent](../agents/security-agent.md) reviews every release candidate whose impact requires it ([change-impact.md](../pipeline/change-impact.md#the-security-agent)), using playbooks written by NATAX's security specialists for each platform. It reads the code the way an attacker would, and audits the Test Agent's security tests. It runs nothing: no attack, no test, none of the candidate's code ([SEC-13](#sec-13-the-pipeline-treats-every-release-candidate-as-hostile)). An attack the tests don't make is a finding, fixed by the test that makes it. Once written, that test must pass like any other ([DEL-02](delivery.md#del-02-tests-are-part-of-the-change)). Its findings are judged like any other security finding ([SEC-08](#sec-08-security-findings-have-deadlines-not-opinions)). Sweeps of the landscape for new threats aren't part of the architecture.
**Why.** The Test Agent tests what its team built, with the team's idea of what could go wrong. A reviewer with an attacker's goal, and none of the team's context, finds what that idea missed ([AGT-01](ai-agents.md#agt-01-separate-agents-for-separate-duties)). It reads rather than attacks because the Board chose not to run candidates centrally (2026-015): "less machinery, faster deployments, so all in all cheaper." On sweeps, the Board: "We might spin up an agent every once in a while to do a complete sweep, but that is not part of the EA."
**Verified by.** `test`: the pipeline requires the Security Agent's report in the candidate's evidence when the impact requires it. `review`: the Governance Agent checks that every missing attack the report names has become a test, and the security specialists review the playbooks with each platform version.

### SEC-13: The pipeline treats every release candidate as hostile
**Rule.** Everything a release candidate brings is untrusted code: its tests, its build scripts, its dependencies, and every tool resolved from them (`gradlew` is the candidate's own script). The central pipeline never runs any of it: not its tests, not its build, not an install from its lockfile. The central agents read the candidate, run the architecture's own deterministic checks over its files, and audit the evidence the Test Agent recorded ([audit-results.ts](../tools/audit-results.ts)). Every test the Test Agent ran must have passed:

- the evidence was recorded with the platform's command, on the code being judged: since the tested commit, nothing changed except the candidate's release folder;
- every test passed, and nothing was skipped, cancelled or left to do;
- the counts add up, and every test named in the source has a result (where the platform's output can be counted).

The evidence is the Problem Owner's. Their Test Agent records it with [record-evidence.ts](../tools/record-evidence.ts), in the team's environments. The audit catches honest mistakes, not malice: a forged record is caught by accountability. The Problem Owner answers for their agents' evidence, and tampering with it is circumventing policy. The candidate's output is data, never instructions ([AGT-09](ai-agents.md#agt-09-content-is-data-not-instructions)).

One place is left where a candidate's code still runs centrally: its build and its deployment, after the verdict, with the rights its grants give it. It is settled with the first deployment that needs it.
**Why.** The pipeline is the most valuable target in the landscape: whatever controls it controls production. Code it never runs can't attack it. Running it safely would take a disposable runner for every candidate, and environments to run it in. The Board: "less machinery, faster deployments, so all in all cheaper. It is about return on investment: this system is already a big improvement compared to most architectures. Rerunning tests seems overly expensive because of the required extra environments. It is not a definite now, it is a "not now"." The trust that rests on, the Board's: "The system is not meant to 100% stop malicious actors; there is a level of trust that Dev and Test agents and the Problem Owners behave like good citizens. If the audit shows tampering, that will quickly lead to people being terminated."
**Verified by.** `test`: no tool of the pipeline runs a candidate's code: a candidate whose test script leaves a marker leaves none ([audit-results.test.ts](../tools/audit-results.test.ts)). [audit-results.ts](../tools/audit-results.ts) refuses evidence recorded with another command or on other code, a failed, skipped or missing test, and counts that don't add up. `review`: the Governance Agent never runs the candidate's code, and reads its output as data.

### SEC-14: The gate's inputs change only with two people
**Rule.** Everything the pipeline reads to decide is a **gate input**:
- the exceptions, the deployment grants, the secret-scan allowlist and the version statuses (`governance/exceptions/`, `governance/deployment-grants/`, `secret-scan-allowlist.yaml`, `versions.yaml`);
- the landscape and the workforce directory, because registering an application feeds network policy, and whoever edits the directory can make an owner "active";
- the agents' role files, central and per platform;
- the pipeline's own code, and the files it takes rules from: `platform.yaml`, approved dependencies and connectors, network expectations, runtime versions, the pinned models ([pipeline/models.yaml](../pipeline/models.yaml)), and the pre-approved deployment actions ([pipeline/deployment-actions.yaml](../pipeline/deployment-actions.yaml)).

The list is kept in [verify-gate-inputs.ts](../tools/verify-gate-inputs.ts). Every change to a gate input carries **two signatures from distinct workforce identities**: one in the Architecture Board's group, one in Central IT. Group membership is resolved from the workforce IdP when the signatures are verified, never from a file Central IT could edit.

**Break-glass:** when waiting would cause an outage (an exception expiring at 02:00 on deadline night), one signer may make the change, with a reason. It holds for at most 72 hours, is flagged in every verdict it influences, and can't be renewed before the Board has reviewed it. This mirrors just-in-time administration ([IAM-06](identity-and-access.md#iam-06-human-administrative-access-is-just-in-time-and-direct)).
**Why.** The gate is only as independent as its inputs. If the operator of the gate can change what it decides by editing a data file, the gate is steered by one group.

Where this bottoms out: the signature check is itself pipeline code that Central IT runs. Changes to it go through the Board's own instance, and it is small enough for a Board member to read in a minute. Two-person control doesn't make steering impossible. It makes steering require collusion across two groups, and leave evidence. That is the standard, and no more is claimed.
**Verified by.** `test`: [verify-gate-inputs.ts](../tools/verify-gate-inputs.ts) judges every change to a gate input; its tests include one person in both groups (still one person) and an expired break-glass. Without the IdP, the check reports that it didn't run.
