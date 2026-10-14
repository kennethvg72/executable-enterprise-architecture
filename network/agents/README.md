# Agents in the Zero Trust network domain

These add to the [central role definitions](../../enterprise-architecture/agents/README.md). They don't replace them.

## Development Agent (any application)

When a change needs a new network path, the Development Agent:

1. Adds the dependency to the application's `consumes`, with a `purpose` a human can understand.
2. Checks whether the provider already accepts the application as a consumer. If not, it tells the Problem Owner that the provider's owner must approve, and drafts the change to the provider's `provides.consumers` for that owner to review ([INT-06](../../enterprise-architecture/principles/integration.md#int-06-dont-break-consumers-and-onboard-them-without-ceremony)). It never edits another team's declarations itself.
3. Runs `npm run generate` and `npm run verify`, and reads [generated/flows.md](../generated/flows.md) to check the new path is exactly what was intended: no more, no less.

## Development Agent (network specialists' changes)

When Central IT changes the landscape itself (new sites, zones, shared services, platform flows), the Development Agent works with the network specialists:

1. It changes `landscape.yaml`, never generated files ([ZTN-01](../standards.md#ztn-01-policy-is-generated-from-intent-never-written-by-hand)).
2. For brownfield work, it follows [rollout.md](../rollout.md): observed traffic is evidence, not permission.
3. It changes the compiler or renderers only with tests that show the defect being fixed.

## Test Agent

The network Test Agent:

1. **Writes expectations from intent**, in [expectations.yaml](../expectations.yaml), without reading the compiler. For each application, it covers at least: its legitimate paths (allow), its database's other nodes and replicas (deny), other applications' databases (deny), direct internet access (deny), administration from anything but PAWs (deny), and test and acceptance (deny).
2. **Adds invariants** to [verify.ts](../tools/verify.ts) when a class of mistake could happen in any landscape, not just today's.
3. **Breaks things on purpose** in tests ([network.test.ts](../tools/network.test.ts)): makes one realistic mistake in a copy of the landscape, and checks that the tools catch it with a useful path forward.
4. **Investigates probe failures** and classifies each one under [ZTN-08](../standards.md#ztn-08-when-the-policy-breaks-something-legitimate-find-out-which-of-three-things-was-wrong).

## Governance Agent

For release candidates whose impact includes **network**, the Governance Agent:

- Requires `npm run verify` to pass, with the generated files up to date.
- Reads the diff of [generated/flows.md](../generated/flows.md) between the candidate and production: every added flow must be explained by a requirement, and every removed flow must be safe to remove (contract after expand, see [deployment.md](../../enterprise-architecture/pipeline/deployment.md#order-of-changes)).
- Checks that an undeclared outbound call in the code (a new HTTP client, a new hostname) has a matching `consumes` entry. Code that calls something the manifest doesn't declare will fail in production, and that's a finding.
