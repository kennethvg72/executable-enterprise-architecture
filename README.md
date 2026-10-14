# Executable Enterprise Architecture

This repository is an Enterprise Architecture that AI agents can execute.

It is written in Markdown so that humans and AI agents read the same thing. AI agents use it to design, build, test and govern solutions. Where an outcome must be deterministic, the architecture comes with tests and policy checks that enforce it. These files aren't documentation about the architecture. They *are* the architecture.

It belongs to **NATAX (Naturally Aspirated Tax)**, a fictional financial services company that writes tax filing software. NATAX is invented, but the problems are real. Fork the repository, replace NATAX with your own organization, and challenge every decision in it.

## Start here

| If you are... | Read |
|---|---|
| A Problem Owner who wants to solve something | Open your AI coding agent (Claude Code, Codex, ...) and tell it: *"Clone this repository, read BOOTSTRAP.md, and follow its instructions."* |
| Curious what this is | [The agent model](enterprise-architecture/agents/README.md), then [NATAX's landscape](enterprise-architecture/landscape/README.md) |
| An architect | [The central architecture](enterprise-architecture/README.md), and [how it changes](enterprise-architecture/governance/README.md) |
| Interested in the release pipeline | [The central pipeline](enterprise-architecture/pipeline/README.md) |

## How it's organized

Some architecture applies to everything. Some the Problem Owner chooses.

```
BOOTSTRAP.md                  the start: environment, agents, the problem, the landscape check, the platform

ALWAYS APPLIES
enterprise-architecture/      the principles, the agent roles, the pipeline, governance, and NATAX's landscape,
                              including landscape.md: every application NATAX has (look before you build)
network/                      Zero Trust: every connection declared, generated into policy, tested
infrastructure/               availability, load balancing, capacity: from service intent to tested configuration

CHOSEN PER APPLICATION
platforms/
  typescript-web/             web applications and APIs: a runnable template, no framework
  power-apps/                 Power Apps on Microsoft 365: security on the data, not in the app
  android/                    Android apps on managed devices: the device is not trusted
```

Every application, on every platform, pins the versions of the architectures that govern it, and passes the same central pipeline. What differs per platform is *how* the principles are met: a host firewall for a TypeScript service, a data loss prevention policy for a Power App, an identity-checked API for an Android app ([platforms/README.md](platforms/README.md)).

Applications themselves live in their own repositories. This repository is the architecture they're built under.

## From the article to the repository

| The article says | Where to see it |
|---|---|
| *"Clone this repository, read BOOTSTRAP.md, and follow its instructions."* | [BOOTSTRAP.md](BOOTSTRAP.md): done when the environment demonstrably works, not when an installer exits |
| The Problem Owner, and the Development, Local Governance, Test, Security and Governance Agents | [enterprise-architecture/agents/](enterprise-architecture/agents/README.md), including who can overrule whom |
| *"Go"* and *"Release"* | [AGT-06](enterprise-architecture/principles/ai-agents.md#agt-06-the-problem-owner-holds-the-gates) |
| The Markdown files *are* the Enterprise Architecture | [enterprise-architecture/principles/](enterprise-architecture/principles/): every rule with its reason and how it's verified |
| Deterministic where it must be | [AGT-10](enterprise-architecture/principles/ai-agents.md#agt-10-deterministic-where-it-must-be); the [tools](enterprise-architecture/tools/) and the [pipeline's checks](enterprise-architecture/pipeline/checks.md) |
| One architecture, technology-specific repositories | Here as folders in one repository, to keep it easy to read: the central architecture, network and infrastructure, and three [platforms](platforms/README.md), each versioned separately ([versions.yaml](enterprise-architecture/governance/versions.yaml)) |
| *"No is not a complete architectural decision"* | [Verdicts](enterprise-architecture/pipeline/verdict.md) and [escalations](enterprise-architecture/governance/escalation.md) always carry a path forward |
| Engineering challenges the architecture | [Proposal 2026-001](enterprise-architecture/governance/proposals/2026-001-deadline-night-coverage.md), from an application's escalation |
| Architecture versions: proposed, active, deprecated, decommissioned | [lifecycle.md](enterprise-architecture/governance/lifecycle.md) |
| Zero Trust: intent, policy, thousands of probes; observed traffic is evidence, not permission | [network/](network/README.md) |
| Meaningful health checks; do we need OpenShift?; HA and DR as one discipline | [infrastructure/](infrastructure/README.md), [make-or-buy.md](infrastructure/make-or-buy.md), [resilience.md](enterprise-architecture/principles/resilience.md) |
| Build instead of buy; use what you own; simplify what you've accumulated | [simplicity.md](enterprise-architecture/principles/simplicity.md), [accumulated-complexity.md](enterprise-architecture/landscape/accumulated-complexity.md) |
| Citizen development | [platforms/](platforms/README.md), each with limits the pipeline enforces; and [look before you build](enterprise-architecture/principles/simplicity.md#sim-09-look-before-you-build), so the next application isn't a duplicate |

## Runnable parts

Everything runnable uses Node.js 24 or later, which runs TypeScript directly with no build step.

```sh
npm install        # once: installs TypeScript and a YAML parser
npm test           # the tools' own tests: each makes a realistic mistake and checks it's caught
npm run generate   # compile intent into firewall rules, load balancer and database configuration
npm run verify     # check the generated policy and configuration against the architecture
npm run pipeline -- <path to an application>        # the pipeline's deterministic stage for an application
node infrastructure/tools/simulate.ts               # what happens when sites and links fail
```

The TypeScript platform's [template](platforms/typescript-web/template/) is a working application skeleton, with its own tests against PostgreSQL. The Power Apps and Android platforms are architecture, limits and checks; their platform tools run where a tenant or an Android SDK is available.

## Status

A proof of concept that accompanies an article. Substantial enough to work; not a finished product. The pipeline is a procedure agents follow, not a CI system, which keeps this repository free of platform dependencies.

## License

Public domain ([Unlicense](LICENSE)). Do with it whatever you like; no attribution needed.
