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
| Deployment process | Deploy candidates that have an approved verdict, by digest. It is the only identity with production write access. It cannot approve. |
| Architecture Board | Change the architecture, and with it what the Governance Agent may approve. Grant exceptions. It doesn't approve individual candidates. |
| Central IT | Operate the pipeline itself. Changes to the pipeline go through a pipeline: the same rules, a separate instance. |

Separating "approve" from "deploy" is separation of duties: neither function can complete a production change on its own. It doesn't make compromise harmless. A compromised Governance Agent could approve something malicious, which is why its decisions are recorded, explained and checkable, and why the deterministic checks can't be overridden. A compromised deployment process holds production write access, which is why it deploys only digests that carry an approved verdict, and why its records are tamper-resistant.

Code from release candidates runs only in disposable, unprivileged runners ([SEC-13](../principles/security.md#sec-13-the-pipeline-treats-every-release-candidate-as-hostile)), never where verdicts are written or deployment credentials live. A hostile canary verifies that isolation, and `pipeline.ts` runs candidate code only with `--isolated`.

## Running the pipeline here

To run the pipeline against an application in this repository, start a **separate** agent session, preferably on a different model family from the one that built the application ([AGT-03](../principles/ai-agents.md#agt-03-use-different-models-for-independence)), and give it this instruction:

> Act as the Governance Agent defined in `enterprise-architecture/agents/governance-agent.md`. Follow `enterprise-architecture/pipeline/README.md` for the release candidate at `<application repository>/releases/<id>/`. Write your verdict next to the candidate.

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

In this proof of concept, some things are simulated:
- Evidence provenance (signed reviews, the Problem Owner's signed "Release") is replaced by files in the repository. The Governance Agent says so in its verdict.
- Test, acceptance and production deployment (stages 5, 6 and 8) are described, not executed. There is no NATAX to deploy to.
