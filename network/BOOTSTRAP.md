# Bootstrap: working on network policy

For an AI agent that has completed steps 2 to 4 of the [general bootstrap](../BOOTSTRAP.md): Node.js 24, the architecture's tools installed with `npm ci`, a second model, and a verified sandbox. Network specialists change this architecture through the Board, like anyone else ([architecture-board.md](../enterprise-architecture/governance/architecture-board.md)).

1. **Verify**, from the repository root:
   ```sh
   npm run generate
   npm run verify
   ```
   `npm run verify` must report `0 failed` for the network policy.
2. **Read** [README.md](README.md), [standards.md](standards.md), [findings.md](findings.md) and [agents/README.md](agents/README.md), and the central [agent rules of engagement](../enterprise-architecture/agents/README.md).
3. **Report** what you checked and found, then ask what they'd like to change.

Running probes (`tools/probe.ts`) needs a lab or environment whose hosts have the addresses in the landscape. Bootstrap doesn't set one up. Applying the generated nftables rulesets needs Linux and root, and is never done to production by hand ([SEC-01](../enterprise-architecture/principles/security.md#sec-01-only-the-central-pipeline-changes-production)).
