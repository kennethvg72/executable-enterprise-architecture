# Bootstrap

You are an AI coding agent, and someone has asked you to read this file and follow its instructions. This repository is the NATAX Enterprise Architecture ([README.md](README.md)). This procedure prepares a working environment, finds out what the person wants to solve, and hands over to the right platform.

**Bootstrap is complete when the environment demonstrably works**, not when an installer exits successfully.

## Ground rules

- **Reuse what's there.** If a tool is installed in a suitable version, use it.
- **Ask before anything that needs administrator rights** (`sudo`, an elevated terminal, a restart, accepting a license), and say why.
- **Install only what this procedure, or the platform's, lists.** Anything else, ask first.
- **When something fails, investigate and fix it.** Don't skip a step, disable a test, turn off the sandbox or weaken a check. If you can't fix it, say exactly what's wrong and what you tried.
- **Talk in plain language.** The person may not be a developer.
- **Never touch production**, and never ask for production data or credentials ([SEC-01](enterprise-architecture/principles/security.md#sec-01-only-the-central-pipeline-changes-production), [DAT-04](enterprise-architecture/principles/data.md#dat-04-non-production-environments-use-synthetic-data-only)).

Keep notes as you go, in `bootstrap-notes.md` in the folder you work in, never committed (this repository ignores it). They end up in the application's `docs/environment.md`.

## 1. What do they want to do?

Ask, unless they've already said:

| They want to... | Then |
|---|---|
| Solve a problem with a new application | Continue with step 2. This is the usual case, and the person is the **Problem Owner**. |
| Change an existing application | Do steps 2 to 4, then clone the application's repository, read its `AGENTS.md`, and follow its platform's bootstrap for an existing application. If they aren't its Problem Owner, they talk to them first. |
| Work on network policy | Do steps 2 to 4, then [network/BOOTSTRAP.md](network/BOOTSTRAP.md) (for network specialists) |
| Work on load balancing, databases, capacity or resilience | Do steps 2 to 4, then [infrastructure/BOOTSTRAP.md](infrastructure/BOOTSTRAP.md) (for infrastructure specialists) |
| Understand or improve the architecture itself | Read [README.md](README.md) and [AGENTS.md](AGENTS.md); do steps 2 to 4, then stop |

## 2. Base tools

Check, and install if missing (asking first): `git`, and **Node.js 24 or later**, which runs this architecture's own checks on every platform. On Windows, macOS and Linux alike, use the operating system's package manager or the official installer. If the Linux distribution's own package is older than 24, use the Node.js project's packages (NodeSource) instead.

**Done when:** `git --version` works, and `node --version` prints v24 or later.

## 3. The architecture, and its checks

Clone this repository if you're not already in it, and run its own checks:

```sh
npm ci
npm test
```

From now on, `ARCHITECTURE` means the path of this repository. Treat it as read-only ([AGT-04](enterprise-architecture/principles/ai-agents.md#agt-04-agents-read-the-architecture-they-dont-edit-it)).

**Done when:** `npm test` passes.

## 4. The other agents, and the sandbox

**A second model.** The Test Agent and the Local Governance Agent should run on a different model family from yours ([AGT-03](enterprise-architecture/principles/ai-agents.md#agt-03-use-different-models-for-independence)). If you are Claude, check `codex --version` and `codex login status`. If you are Codex, check that `claude -p "reply with ok"` answers. If the other tool is missing, offer to install it; signing in is something the person does themselves. If they'd rather not, separate sessions of your own model will do, and you record the reduced independence.

**The sandbox** ([SEC-11](enterprise-architecture/principles/security.md#sec-11-contain-the-tools-including-the-ai-ones)). Agents run commands sandboxed, with write access limited to the workspace (Claude Code: `/sandbox`; Codex: `--sandbox workspace-write`). On Linux and WSL, Claude Code's sandbox needs `bubblewrap` and `socat`; install them if missing (asking first). Verify it: from inside the agent, try to write outside the workspace. This works in any shell:

```sh
node -e "require('fs').writeFileSync(require('os').homedir() + '/.natax-sandbox-check', 'x')"
```

It must fail. If it succeeds, remove the file and help the person enable the sandbox. On native Windows, the agent may have no sandbox at all. Then record that in your notes, and run nothing that changes the computer until the platform's bootstrap provides one (for TypeScript, by moving into WSL). Reading and talking are fine.

**Done when:** you know which model will test, and a write outside the workspace was demonstrably refused, or, on native Windows, the missing sandbox is recorded and you're working read-only.

## 5. The problem

Now you are the **Development Agent** ([role](enterprise-architecture/agents/development-agent.md)). Ask:

> **What problem would you like to solve?**

Listen for the problem, not a solution: who has it, how often, what it costs them, how they'll know it's solved. Challenge assumptions. Explain how you'll work together: you'll discuss and challenge freely, you'll build only when they say **"Go"**, and you'll prepare a release only when they say **"Release"**.

## 6. Look before you build

Read [the landscape](enterprise-architecture/landscape/landscape.md) with the problem in mind ([SIM-09](enterprise-architecture/principles/simplicity.md#sim-09-look-before-you-build)). If something there solves the problem, or most of it, say so, and encourage the Problem Owner to talk to its owner before anything is built. Offer to draft what to ask. The outcome is one of:

- **Use it.** Nothing to build, and nothing more to install. Bootstrap ends here, successfully.
- **Extend it.** Its owner agrees; the work happens in that application's repository, under its owner.
- **Build anyway**, for a reason you'll record, preferably agreed with the existing application's owner.

Write the outcome down: it becomes the new application's first decision record (`docs/decisions/0000-landscape-check.md`).

## 7. Choose the platform

Together with the Problem Owner, choose the simplest platform that fits, using [platforms/README.md](platforms/README.md). Explain the choice in their terms, including what the platform can't do: *"A Power App is quickest, but it can't be used by customers, and when Microsoft 365 is down, so is this."*

Then follow the platform's own bootstrap:

| Platform | Bootstrap |
|---|---|
| TypeScript web application | [platforms/typescript-web/BOOTSTRAP.md](platforms/typescript-web/BOOTSTRAP.md) |
| Power Apps | [platforms/power-apps/BOOTSTRAP.md](platforms/power-apps/BOOTSTRAP.md) |
| Android app | [platforms/android/BOOTSTRAP.md](platforms/android/BOOTSTRAP.md) |

It ends with a new repository that demonstrably works, and the conversation continues from there.
