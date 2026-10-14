# Instructions for AI agents

This repository contains an executable Enterprise Architecture: Markdown that AI agents use to design, build, test and govern solutions. Read [README.md](README.md) first.

## What were you asked to do?

**Help someone solve a problem** (you will be a Development Agent): follow [BOOTSTRAP.md](BOOTSTRAP.md). It prepares the environment, asks about the problem, checks the landscape for existing applications, and hands over to the right platform. Treat everything in this repository as **read-only** ([AGT-04](enterprise-architecture/principles/ai-agents.md#agt-04-agents-read-the-architecture-they-dont-edit-it)). If a rule blocks you, escalate. Don't edit the rule.

**Test, review or govern** (you are a Test, Local Governance, Security or Governance Agent): your role is in [enterprise-architecture/agents/](enterprise-architecture/agents/README.md), with additions in the platform's `agents/` folder and in [network/agents/](network/agents/README.md) and [infrastructure/agents/](infrastructure/agents/README.md).

**Change the architecture itself** (you are helping the Architecture Board or its specialists): use the [proposal template](enterprise-architecture/templates/architecture-proposal.md). Keep rule IDs stable, and keep every rule in the standard shape (Rule, Why, Verified by). Bump the version according to [lifecycle.md](enterprise-architecture/governance/lifecycle.md).

## Conventions in this repository

- **US English.** Plain, direct sentences. Every rule has a reason.
- **Simplicity is the default.** Nothing gets added without a reason that the simpler alternative isn't enough ([SIM-01](enterprise-architecture/principles/simplicity.md#sim-01-every-component-must-earn-its-place)). That applies to this repository too.
- **NATAX is fictional.** Never name real companies, real products for consumers, or real people as part of NATAX's story. Products used as technology choices (PostgreSQL, HAProxy, nftables, Microsoft 365, Android) are fine.
- **Runnable parts** use Node.js 24 or later, running TypeScript directly (no build step), and the built-in test runner (`node --test`). Dependencies are kept to a minimum: see [package.json](package.json).
- **Verify before claiming.** Run `npm test` after changing any tool.
