# TypeScript web applications

The architecture for NATAX's TypeScript web applications and APIs: the platform for anything that needs real logic, integration with NATAX systems, customers, taxpayer data or class A resilience, and for the backends of Android apps.

It's also built for citizen development. A support team lead or an analyst who understands a problem can solve it directly, working with agents under these standards. They don't need production rights, and don't get them. Only a compliant release candidate passes the central pipeline.

Version: [VERSION](VERSION). Limits: [platform.yaml](platform.yaml). Governed by the [central architecture](../../enterprise-architecture/README.md), and the always-applied [network](../../network/README.md) and [infrastructure](../../infrastructure/README.md) architectures.

## What's here

| | |
|---|---|
| [BOOTSTRAP.md](BOOTSTRAP.md) | From the general bootstrap to a working environment: Linux (WSL on Windows), Node.js, PostgreSQL, the template |
| [standards.md](standards.md) | The rules for this platform (TS-xx) |
| [anti-patterns.md](anti-patterns.md) | How the TypeScript standards are usually broken, and what to do instead |
| [platform.yaml](platform.yaml) | The limits and checks the pipeline enforces |
| [approved-dependencies.yaml](approved-dependencies.yaml) | The five approved dependencies. Anything else needs a reason. |
| [agents/](agents/) | What the Development, Test, Local Governance and Security Agents do on this platform |
| [template/](template/) | A working, tested application skeleton: sign-in, sessions, CSRF protection, health checks, metrics, logging, migrations, a least-privileged database role and overload protection, in about 900 lines with no framework |

## The opinions, briefly

- **No build step.** Node.js runs TypeScript directly. `tsc` only checks types.
- **No framework.** `node:http` and a small router. The template's whole HTTP layer is under 250 lines, and an agent can explain every one of them.
- **No client-side framework.** HTML rendered on the server, with forms. Browsers have been good at this for thirty years.
- **No ORM.** SQL, parameterized, next to the code that uses it.
- **Real dependencies in tests.** A real PostgreSQL test database, real HTTP requests, and the application running as its own restricted database role. A missing test database fails the tests; it doesn't skip them.
- **Five dependencies**, each with a reason.

None of this is dogma. Each default can be overridden with a decision record that the Governance Agent finds convincing ([SIM-01](../../enterprise-architecture/principles/simplicity.md#sim-01-every-component-must-earn-its-place)). But the burden of proof is on the extra complexity.

## Running the template's tests

The template is runnable here: Node.js 24 and PostgreSQL 18 (see [BOOTSTRAP.md](BOOTSTRAP.md)), then, in `template/`, `cp .env.example .env`, `npm ci`, `npm run db:setup` and `npm test`.
