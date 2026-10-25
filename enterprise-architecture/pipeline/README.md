# The central pipeline

The pipeline is the only way to change NATAX production ([SEC-01](../principles/security.md#sec-01-only-the-central-pipeline-changes-production)). It is owned by Central IT and runs under Central IT's control. Its decisions are made by the [Governance Agent](../agents/governance-agent.md) and by deterministic checks, under rules set by the Architecture Board.

It evaluates a release as **one system**. A code change may need a new network path, a different load balancer health check and more capacity. The pipeline checks all of them together, because in production they fail together.

> **In this proof of concept,** the pipeline is a procedure that an AI agent follows, using the deterministic tools in this repository. It isn't wired into a CI system. See [Running the pipeline here](#running-the-pipeline-here).

## Stages

```
 release candidate
        │
 1. Intake ─────────── complete, owned, released by its Problem Owner, eligible?
        │
 2. Impact ─────────── which domains does this change actually affect?
        │
 3. Deterministic ──── the checks the impact requires: tests, policy, configuration, capacity
        │
 4. Review ─────────── the Governance Agent judges what checks can't
        │
 5. Test ───────────── deploy to test: integration tests, targeted network probes
        │
 6. Acceptance ─────── deploy to acceptance: the Security Agent's attack, failure tests,
        │              rollback rehearsal, where the impact requires them
        │
 7. Verdict ────────── approve, or reject with a compliant path forward
        │ approved
 8. Production ─────── network and load balancer changes first, then a rolling deployment
        │              across DC1 and DC2, verified and rolled back automatically if needed
        ▼
 release record
```

| Stage | What happens | Defined in |
|---|---|---|
| 1. Intake | Check the [release candidate](release-candidate.md) is complete and its evidence is authentic; check the Problem Owner, the pinned architecture versions, the "Release" approval, and the eligibility gates in [checks.md](checks.md#always). | [release-candidate.md](release-candidate.md) |
| 2. Impact | Determine the affected domains from the actual diff. | [change-impact.md](change-impact.md) |
| 3. Deterministic | Run the checks for every affected domain. A failed check that enforces a mandatory rule, and isn't covered by a Board exception, ends the run: reject. | [checks.md](checks.md) |
| 4. Review | The Governance Agent reviews the `review` rules for affected domains, and the local agents' findings. | [governance-agent.md](../agents/governance-agent.md) |
| 5–6. Test, acceptance | Deploy the candidate's artifact to test, then acceptance, and run what the impact requires there, including the [Security Agent](../agents/security-agent.md)'s attack. A failure is a rejection with a path forward, like any other. | [deployment.md](deployment.md) |
| 7. Verdict | Approve or reject, with reasons, rule IDs and, for a rejection, the path forward. | [verdict.md](verdict.md) |
| 8. Production | Promote the approved artifact, by digest. Verify each step. | [deployment.md](deployment.md) |

## Scheduled runs

Not everything runs on every change. These run on a schedule, across the whole landscape:

| What | When | Why |
|---|---|---|
| Full network probe regression | Weekly, and after any change to shared network infrastructure | Catches drift and interactions between policies |
| Configuration drift detection | Daily | [DEL-04](../principles/delivery.md#del-04-infrastructure-and-network-are-code) |
| Ownership check | Weekly | [OWN-02](../principles/ownership.md#own-02-no-owner-means-decommission) |
| Dependency vulnerability scan | Daily | [SEC-05](../principles/security.md#sec-05-dependencies-are-pinned-sourced-and-scanned) |
| Security Agent's landscape sweep | When threats change, and at least monthly | [SEC-12](../principles/security.md#sec-12-security-is-tested-by-someone-who-didnt-build-it) |
| Backup restore tests | Weekly | [DAT-08](../principles/data.md#dat-08-a-backup-isnt-a-backup-until-it-has-been-restored) |
| Database switchover | Monthly | [RES-02](../principles/resilience.md#res-02-dc1-and-dc2-are-both-production-all-the-time) |
| Site failover exercise | Twice a year | [RES-09](../principles/resilience.md#res-09-resilience-is-tested-not-asserted) |
| Architecture impact run | When a new architecture version is proposed | [lifecycle](../governance/lifecycle.md) |

## Who can do what

| Actor | Can |
|---|---|
| Problem Owner | Approve a release candidate for submission ("Release"), with their own identity. |
| Development Agent | Prepare a release candidate and read verdicts. |
| Security Agent | Attack candidates in acceptance with test identities; read production configuration, inventories and observed flows; write findings. It cannot change anything, approve, or deploy. |
| Governance Agent | Read candidates, the architecture and the landscape; run checks; write verdicts. It cannot deploy. |
| Deployment process | Deploy candidates that have an approved verdict in the pipeline's verdict store, by digest. It is the only identity with production write access. It cannot approve. |
| Architecture Board | Change the architecture, and with it what the Governance Agent may approve. Grant exceptions. It doesn't approve individual candidates. |
| Central IT | Operate the pipeline itself. Changes to the pipeline go through a pipeline: the same rules, a separate instance. |

Separating "approve" from "deploy" is separation of duties: neither function can complete a production change on its own. It doesn't make compromise harmless. A compromised Governance Agent could approve something malicious, which is why its decisions are recorded, explained and checkable, and why the deterministic checks can't be overridden. A compromised deployment process holds production write access, which is why it deploys only digests that carry an approved verdict, and why its records are tamper-resistant.

Code from release candidates runs only in disposable, unprivileged runners ([SEC-13](../principles/security.md#sec-13-the-pipeline-treats-every-release-candidate-as-hostile)), never where verdicts are written or deployment credentials live. A hostile canary verifies that isolation, and `pipeline.ts` runs candidate code only with `--isolated`.

## When the AI provider is down

The Governance Agent depends on an AI provider ([AGT-11](../principles/ai-agents.md#agt-11-the-ai-providers-are-governed-like-any-other-dependency)). If the provider is unavailable when a fix must ship (a security finding rated *Critical*, or a production incident during the peak freeze), the **emergency lane** applies:

1. The candidate's purpose is `security-fix` or `fix`, and the diff is limited to that fix.
2. Every deterministic check runs and passes, the authorities included. Nothing in the emergency lane is skipped.
3. Two people approve it in the Governance Agent's place: an Architecture Board member and Central IT's on-call engineer, distinct identities, each signing the verdict.
4. The verdict says it was the emergency lane, and the Governance Agent reviews the release as soon as the provider is back. A finding then is handled like any other, with the release rolled back if needed.

The lane is for when the provider is down, not when its answer is inconvenient.

## Running the pipeline here

The Governance Agent runs once per release candidate, as a command, never as a conversation: whoever wants the release never talks to the judge ([AGT-01](../principles/ai-agents.md#agt-01-separate-agents-for-separate-duties)). Pin a model from a different family than the one that built the application ([AGT-03](../principles/ai-agents.md#agt-03-use-different-models-for-independence)), after it has passed the regression set ([AGT-11](../principles/ai-agents.md#agt-11-the-ai-providers-are-governed-like-any-other-dependency)):

```sh
node enterprise-architecture/tools/regression.ts <provider> <model>      # writes pipeline/regression/results/...
# then pin provider, model and that result in pipeline/models.yaml: a release of the pipeline
node enterprise-architecture/tools/govern.ts <application repository> <candidate id> [--isolated]
```

`regression.ts` shows the model each sample without its answer, next to a copy of the architecture that leaves the regression set out. `govern.ts` refuses a model that isn't pinned with a passing result, clones the candidate at its commit, runs the deterministic stage, and asks the model, sandboxed read-only, for the verdict. A model can't approve what the deterministic stage didn't pass. The record goes to the verdict store (`VERDICT_STORE`, or `~/verdict-store`) once, with the transcript and the deterministic output, and is never overwritten; the team gets a copy next to the candidate. Exit 0 approved, 1 rejected, 3 no verdict.

The deterministic stage is one command:

```sh
npm run pipeline -- <path to the application repository> [--isolated]
```

It validates the manifest against the application's platform, scans for secrets, checks dependencies, compiles and verifies the network policy, renders and verifies the load balancer configuration, checks capacity and topology, and runs the platform's own checks. It reports which checks ran and which were skipped, and the Governance Agent includes that output in the verdict.

The result is one of three, because a check that didn't run proves nothing:

| Result | Meaning | Exit code |
|---|---|---|
| **PASS** | Every mandatory check ran and passed | 0 |
| **FAIL** | At least one check failed | 1 |
| **INCOMPLETE** | Nothing failed, but a mandatory check couldn't run (a missing tool, no test database, no isolated runner) | 3 |

Only PASS lets the stage pass. INCOMPLETE blocks a verdict like a failure; the path forward is to run the missing checks, not to explain them away.

The platform's checks run the candidate's own code: its tests, its build scripts, the tools its lockfile installs. They run only with `--isolated`, which states that the command is running inside a disposable runner ([SEC-13](../principles/security.md#sec-13-the-pipeline-treats-every-release-candidate-as-hostile)). The flag doesn't create isolation; the hostile canary verifies it:

```sh
node enterprise-architecture/tools/verify-runner.ts    # inside the runner: every escape attempt must fail
```

Run on a laptop, the canary shows what a release candidate could do there: read its credentials, write outside the workspace, reach the internet. That's why `--isolated` exists. In this proof of concept there is no runner, so a Governance Agent session runs the application's checks only inside its own verified sandbox (BOOTSTRAP, step 4), and says so in its verdict.

What has to be true for the stage to pass, beyond the checks themselves:

- **The architecture is an approved version.** Every architecture the candidate pins must match its version tag exactly (`network/v1.0.0`, ...), with nothing changed, committed or not. Otherwise the stage is INCOMPLETE: it can't judge against rules nobody approved.
- **The authorities ran.** Network and infrastructure checks have a fast reader tier and an authority tier ([DEL-06](../principles/delivery.md#del-06-checks-verify-the-output-not-the-intent-that-produced-it)). Without Linux and the pinned tool versions, the authorities can't run and the stage is INCOMPLETE.
- **The gate's inputs are signed** by the Board and Central IT ([SEC-14](../principles/security.md#sec-14-the-gates-inputs-change-only-with-two-people)). That needs the workforce IdP, so here it is reported as not run.

On a laptop, then, the honest result is INCOMPLETE. The parts that did run still show their findings.

In this proof of concept, some things are simulated:
- The Problem Owner's signed "Release" is replaced by a file in the repository, and the verdict store by the verdict file next to the candidate. The Governance Agent says so in its verdict.
- Test, acceptance and production deployment (stages 5, 6 and 8) are described, not executed. There is no NATAX to deploy to.
