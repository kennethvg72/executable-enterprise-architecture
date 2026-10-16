# Bootstrap: working on infrastructure

For an AI agent that has completed steps 2 to 4 of the [general bootstrap](../BOOTSTRAP.md): Node.js 24, the architecture's tools installed with `npm ci`, a second model, and a verified sandbox. Infrastructure specialists change this architecture through the Board, like anyone else ([architecture-board.md](../enterprise-architecture/governance/architecture-board.md)).

1. **Verify**, from the repository root:
   ```sh
   npm run generate
   npm run verify
   node infrastructure/tools/simulate.ts
   ```
   `npm run verify` must report `0 failed` for infrastructure (INCOMPLETE without HAProxy in the pinned version, as for the network), and the simulation must show **ok** for the direct fiber cut.
2. **Read** [README.md](README.md), [standards.md](standards.md), [failure-scenarios.md](failure-scenarios.md), [make-or-buy.md](make-or-buy.md) and [agents/README.md](agents/README.md), and the central [agent rules of engagement](../enterprise-architecture/agents/README.md).
3. **Report** what you checked and found, then ask what they'd like to change.

The generated HAProxy and Patroni configuration can be validated further with the products themselves (`haproxy -c -f <file>`) if they are installed. Bootstrap doesn't install them. Deploying configuration is the pipeline's job, never done by hand ([SEC-01](../enterprise-architecture/principles/security.md#sec-01-only-the-central-pipeline-changes-production)).
