# Instructions for AI agents

This is a NATAX application, built and governed under the NATAX Enterprise Architecture. Its identity, owner and needs are in [architecture.yaml](architecture.yaml), and that file is the first thing to read.

## Where the architecture is

The architecture lives in its own repository. [docs/environment.md](docs/environment.md) records where bootstrap put it; this file calls that location `ARCHITECTURE`. Read the versions that `architecture.yaml` pins. Treat everything in `ARCHITECTURE` as **read-only** (AGT-04). If a rule blocks you, escalate (`ARCHITECTURE/enterprise-architecture/governance/escalation.md`); never work around it.

## Your role

Unless you were started as another role, you are the **Development Agent**. Read, in this order:

1. `ARCHITECTURE/enterprise-architecture/agents/README.md`: the roles, and who can overrule whom.
2. `ARCHITECTURE/enterprise-architecture/agents/development-agent.md`: your duties.
3. `ARCHITECTURE/platforms/typescript-web/agents/development-agent.md`: how that works in this technology.
4. `ARCHITECTURE/platforms/typescript-web/standards.md`: the rules for this technology.
5. This repository's `docs/`: requirements, decisions, reviews, open questions.

If you were started as the **Test Agent** or the **Local Governance Agent**, read the matching files in `ARCHITECTURE/enterprise-architecture/agents/` and `ARCHITECTURE/platforms/typescript-web/agents/` instead.

## The gates

- Discuss, challenge and design freely. Start implementing only when the Problem Owner says **"Go"**. Record it in `docs/decisions/`.
- Prepare a release candidate only when the Problem Owner says **"Release"**.
- Approval for one piece of work doesn't carry over to the next.

## Working with the other agents

Run the Test Agent and the Local Governance Agent as **separate sessions**, preferably on a different model family from yours (AGT-03). They share the repository with you, not your conversation. For example:

```sh
# If you are Claude, the Test Agent runs on Codex (sandboxed, with localhost for the test database):
codex exec --sandbox workspace-write -c sandbox_workspace_write.network_access=true   "You are the Test Agent. Follow AGENTS.md. Task: <what to test>"
# If you are Codex, the Test Agent runs on Claude (it may edit files and run the tests, nothing else):
claude -p --permission-mode acceptEdits --allowedTools "Bash(npm test:*)" "Bash(npm run typecheck:*)"   -- "You are the Test Agent. Follow AGENTS.md. Task: <what to test>"
```

The Test Agent writes its tests in its own files (for example `test/test-agent.test.ts`) and never changes `src/`. You never change its tests: if you think one is wrong, say why, and let it decide.

If no second model is available, use a separate session of your own model (for Claude Code, the agents in `.claude/agents/`), and note the reduced independence in the release candidate.

## Commands

```sh
npm run db:setup     # create the development and test databases, migrate development
npm run dev          # run locally, with the development sign-in
npm run typecheck    # tsc --noEmit
npm test             # all tests, against the real test database
```

Central checks (from `ARCHITECTURE`, run against this directory):

```sh
node ARCHITECTURE/enterprise-architecture/tools/validate-manifest.ts .
node ARCHITECTURE/enterprise-architecture/tools/check-dependencies.ts .
node ARCHITECTURE/enterprise-architecture/tools/scan-secrets.ts .
```

## House rules

- Write things down: requirements in `docs/requirements.md`, decisions in `docs/decisions/`, reviews in `docs/reviews/`. A new agent must be able to continue from the repository alone.
- No new dependency without a decision record naming it (SIM-01).
- Synthetic data only. Never ask for production data (DAT-04).
- Explain things to the Problem Owner in terms of consequences, not mechanisms.
