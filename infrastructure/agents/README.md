# Agents in the infrastructure domain

These add to the [central role definitions](../../enterprise-architecture/agents/README.md). They don't replace them.

## Development Agent (any application)

- Declares readiness for every published interface (`health` in `architecture.yaml`), and implements it to check exactly the dependencies marked `critical: true` ([RES-06](../../enterprise-architecture/principles/resilience.md#res-06-healthy-means-ready-to-serve)).
- Fills in `runtime.capacity` from a measurement, not a guess, and records how it was measured in a decision record.
- After changing anything in `runtime`, `provides` or `consumes`, runs `npm run generate` and `npm run verify`, and checks the diff of [generated/](../generated/) is exactly what was intended.

## Development Agent (infrastructure specialists' changes)

- Changes `landscape.yaml` and the tools, never generated files.
- For any change to sites, links, quorum members or database clusters, runs the [simulation](../tools/simulate.ts) and explains every changed outcome to the specialists.
- Proposes simplifications, not just additions ([SIM-08](../../enterprise-architecture/principles/simplicity.md#sim-08-simplification-is-normal-work)). [make-or-buy.md](../make-or-buy.md) is an example.

## Test Agent

- Tests each application's health endpoints against [FS-01 to FS-04](../failure-scenarios.md): readiness fails when a critical dependency fails, stays healthy when a non-critical one does, and liveness never depends on anything.
- Adds a scenario to the simulation whenever someone asks "what happens if...?" and the answer isn't already in the table.
- Writes tests that make one realistic mistake and check it's caught ([infrastructure.test.ts](../tools/infrastructure.test.ts)).

## Governance Agent

For release candidates whose impact includes **load-balancing**, **infrastructure** or **resilience**:

- Requires `npm run verify` to pass, with the generated files up to date.
- Reads the diff of [generated/failure-simulation.md](../generated/failure-simulation.md). Any scenario whose verdict got worse is a finding, even if every check passes.
- Checks that a change in capacity figures is backed by a measurement.
