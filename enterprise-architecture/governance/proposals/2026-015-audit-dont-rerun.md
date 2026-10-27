# Proposal 2026-015: Audit, don't rerun

Architecture: enterprise-architecture, typescript-web, power-apps, android, infrastructure
Proposed version: enterprise-architecture 6.0.0, typescript-web 2.0.0, power-apps 2.0.0, android 3.0.0, infrastructure 4.0.0 (major: the Test Agent records evidence the pipeline used to produce itself, so the rules get stricter for applications)
Proposed by: Architecture Board
Date: 2026-10-27

## Problem

The pipeline was meant to run every candidate's code itself. That covered its type check, tests and build, in a disposable runner checked by a hostile canary. It also covered the candidate's integration tests, failure tests and rollback rehearsal, and the Security Agent's attacks, in test and acceptance. Doing that safely takes a runner per candidate, environments to deploy every candidate into, and the machinery to keep both honest. The proof of concept never had the runner, so every honest result was INCOMPLETE. And the Test Agent had already run the same tests, in the team's environments.

## Change

1. **The pipeline never runs a candidate's code before the verdict** ([SEC-13](../../principles/security.md#sec-13-the-pipeline-treats-every-release-candidate-as-hostile)). That covers its tests, its build and any install from its lockfile. The central agents read the candidate, and run the architecture's deterministic checks over its files: policy, configuration, capacity, the authorities. Then they audit the evidence the Test Agent recorded. Gone: the disposable runner, `--isolated`, the pipeline's own install and the hostile canary (`verify-runner.ts`, `fixtures/hostile-candidate/`).
2. **Every test must pass, and the audit checks that it did** ([DEL-02](../../principles/delivery.md#del-02-tests-are-part-of-the-change), [audit-results.ts](../../tools/audit-results.ts)).
   - **The record:** the Test Agent records each piece of evidence its platform names with [record-evidence.ts](../../tools/record-evidence.ts): the platform's command, the commit it ran on, its exit code and its raw output. It records only on committed code.
   - **The audit** is deterministic:
     - the evidence was recorded with the platform's command, and exited 0;
     - it was recorded on the code being judged: since the tested commit, nothing changed except the candidate's release folder;
     - where the platform's output can be counted (Node.js's TAP, on typescript-web), every test passed, nothing was skipped, the counts add up, and every test named in the source has a result.
   - **Power Apps and Android:** their output isn't counted, so the audit checks the command, the commit and the exit code.
3. **Accountability covers what the audit can't.** A forged record isn't caught by the audit. The Problem Owner answers for their agents' evidence, and tampering with it is circumventing policy.
4. **Test and acceptance are the teams' environments.** The Test Agent runs its integration, contract and failure tests there, and DAT-07's previous-release tests, and records them as evidence. The pipeline no longer deploys candidates there. The Network Agent's targeted probes still run there: they test the network's policy, not the candidate's code.
5. **The Security Agent reviews; it doesn't attack** ([SEC-12](../../principles/security.md#sec-12-security-is-reviewed-by-someone-who-didnt-build-it), [security-agent.md](../../agents/security-agent.md)). It reads the code the way an attacker would, with the security specialists' playbook for its platform, and audits the Test Agent's security tests. It runs nothing. An attack no test makes is a finding, fixed by the test that makes it, which must then pass like any other. It still runs on a different provider from the Governance Agent (AGT-03).
6. **Landscape sweeps leave the architecture.** The Security Agent's periodic attacks on the landscape and on the pipeline are no longer part of it.
7. **The stewards keep their tests and probes** ([OWN-10](../../principles/ownership.md#own-10-a-shared-system-has-one-steward)). They test a steward's own output, never a candidate's code.
8. **The stages:** test and acceptance (stages 5 and 6) are replaced by one stage, the Security Agent's review. The verdict becomes stage 6, production stage 7.
9. **The one place left:** the build and the deployment, after the verdict, still run a candidate's code centrally, with the rights its grants give it. That is settled with the first deployment that needs it.

## The Board's decisions

Taken on 2026-10-27.

| | Decision | The Board's choice | Why |
|---|---|---|---|
| 1 | Who runs a candidate's tests | The Test Agent, in the team's environments; the central agents audit the results and never rerun them | The Board: "the central agents will no longer run test code. What it should do is: a) it reviews code b) it audits test results: every test done by the Test Agent in the applications repository must PASS." |
| 2 | What the trust rests on | The audit, and the accountability of the Problem Owner and their agents | The Board: "The system is not meant to 100% stop malicious actors; there is a level of trust that Dev and Test agents and the Problem Owners behave like good citizens. If the audit shows tampering, that will quickly lead to people being terminated." |
| 3 | The Security Agent | Reviews code and audits the security tests; runs nothing, attacks nothing | The Board: "My idea is we don't test at all anymore, so also not the security agent." |
| 4 | The runner and the canary | Retired | Follows from decisions 1 and 3: nothing central runs a candidate's code. |
| 5 | Landscape sweeps | Out of the architecture | The Board: "Landscape sweeps are mitigating actions taken outside of the Enterprise Architecture", and "We might spin up an agent every once in a while to do a complete sweep, but that is not part of the EA". |
| 6 | The stewards' tests and probes | Kept | The recommendation, accepted: they test a steward's own output, not a candidate's code, and without them intent on a shared system is checked only by reading. |
| 7 | Why | | The Board: "less machinery, faster deployments, so all in all cheaper. It is about return on investment: this system is already a big improvement compared to most architectures. Rerunning tests seems overly expensive because of the required extra environments. It is not a definite now, it is a "not now"." |
| 8 | Hostile code in the build and the deployment | Settled with the first deployment that needs it | The Board: "There is still one place where hostile code can be executed; that is during the deployment itself." |
| 9 | Test and acceptance | Kept, as the teams' environments for the Test Agent's tests; the pipeline no longer deploys candidates there | Proposed when this was written for NATAX: NATAX's failure tests and previous-release tests need production-like environments, its network probes run from them, and they cost nothing extra on capacity production reserves anyway (RES-03). |
| 10 | Evidence that can't be counted | Power Apps and Android: the command, the commit and the exit code are audited, not the test counts | Proposed when this was written for NATAX: neither platform's test output is TAP. Counting needs a parser per format, which can come when a team needs it. |

## Trade-off

- **The cost.** Nobody central runs the candidate, so a Test Agent that forges its results, or a Problem Owner who lets it, is caught only by accountability. And the independent attacker is gone: the Security Agent finds what can be found by reading, and nobody looks for what can't be.
- **The gain.**
  - Nothing a candidate brings runs where verdicts are written before the verdict. That removes the hardest security problem the pipeline had, along with the runner and the canary that were meant to solve it.
  - The deterministic stage can reach a PASS without a runner.
  - The audit catches honest mistakes: tests run on other code, a test that no longer runs, a skipped test read as a pass.
- **Not now, not never.** The Board's "not now" means that rerunning tests centrally comes back when the cost of the environments for it is worth paying.

## Simplification

Removed:
- `verify-runner.ts` and the hostile canary;
- `--isolated` and the pipeline's own install;
- the runner the pipeline needed;
- two stages, the pipeline's deployments into test and acceptance;
- the Security Agent's sweeps.

Added: two small tools, a recorder and an audit, and the evidence keys in each `platform.yaml`.

## Impact on the landscape

None on what runs. For applications, the Test Agent records the evidence its platform names with `record-evidence.ts` for every release candidate:
- the type check and the tests, on typescript-web;
- the solution checker and the Playwright tests, on Power Apps;
- the Gradle check and the device tests, on Android;
- the previous-release tests and the failure tests, when they apply.

A candidate without them is rejected, and the path forward is to record them.

## Migration

- Applications pin the new versions at their next release.
- The previous versions are deprecated, and decommissioned on 2027-06-01:
  - enterprise-architecture 5.0.0 and 5.1.0;
  - typescript-web 1.x and power-apps 1.x;
  - android 2.0.0 and infrastructure 3.0.0.
- No model is pinned in this proof of concept, so the regression set's change (AP-07) needs no new runs. A Board that pins a model runs the set first, as AGT-11 requires.

---

## Board decision

Date: 2026-10-27
Decision: accepted and activated.
Reasoning: The Board's, in the table above: "less machinery, faster deployments, so all in all cheaper… It is not a definite now, it is a "not now"."
