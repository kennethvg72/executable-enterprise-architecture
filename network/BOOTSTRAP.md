# Bootstrap: working on network policy

For an AI agent that has completed steps 2 to 4 of the [general bootstrap](../BOOTSTRAP.md): Node.js 24, the architecture's tools installed with `npm ci`, a second model, and a verified sandbox. Network specialists change this architecture through the Board, like anyone else ([architecture-board.md](../enterprise-architecture/governance/architecture-board.md)).

1. **Verify**, from the repository root:
   ```sh
   npm run generate
   npm run verify
   ```
   `npm run verify` must report `0 failed` for the network policy. On a machine without Linux and nftables in the pinned version, it ends INCOMPLETE (exit code 3): the fast reader ran and found nothing wrong, but the authority, which proves it, couldn't. That's expected on a laptop. To prove it, run it in Linux as root, with nftables in the version in [runtime-versions.yaml](runtime-versions.yaml) (WSL with Ubuntu 24.04 works): `sudo npm run verify` must pass, and `sudo npm run test:authority` shows that real nftables catches what the reader would miss.
2. **Read** [README.md](README.md), [standards.md](standards.md), [findings.md](findings.md) and [agents/README.md](agents/README.md), and the central [agent rules of engagement](../enterprise-architecture/agents/README.md).
3. **Report** what you checked and found, then ask what they'd like to change.

Running probes (`tools/probe.ts`) needs a lab or environment whose hosts have the addresses in the landscape. Bootstrap doesn't set one up. Applying the generated nftables rulesets needs Linux and root, and is never done to production by hand ([SEC-01](../enterprise-architecture/principles/security.md#sec-01-only-the-central-pipeline-changes-production)).
