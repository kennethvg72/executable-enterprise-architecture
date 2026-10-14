# Simplicity (SIM)

Some systems are complex because their requirements demand it. Much enterprise complexity is different: it accumulated. Amendments and workarounds pile up, along with inherited decisions, products bought to compensate for other products, and procedures that exist to manage difficult handovers. NATAX accepted that complexity because removing it was expensive. AI-assisted engineering has changed that cost, so these rules have changed with it.

A simpler solution isn't the same as a smaller one. A PostgreSQL cluster with automatic failover is simpler than a single database server plus a manual recovery procedure that nobody has rehearsed. Simplicity means the fewest moving parts that *demonstrably* meet the real requirements, with nothing added for requirements that nobody has.

### SIM-01: Every component must earn its place
**Rule.** Every product, platform, framework, library, service, queue, cache and network hop in a solution must have a reason that the simpler alternative isn't enough. The reason must be recorded in a decision record, or in the platform architecture's list of approved defaults.
**Why.** Every component has a lifetime cost: it has to be patched, upgraded, monitored, understood and eventually removed. That cost is easy to ignore when the component is adopted.
**Verified by.** `test`: the pipeline compares the application's dependency manifests with the technology's approved defaults and the application's decision records. Any dependency without either fails the check. `review`: the Governance Agent judges whether the recorded reason is real.

### SIM-02: Use what the platform already provides
**Rule.** Before adding a component, use what is already there: the language's standard library, the browser's built-in APIs, the operating system, PostgreSQL's features, and NATAX's shared services.
**Why.** The capability is already paid for, already patched and already understood.
**Verified by.** `review`.

### SIM-03: Decide build versus buy on today's economics
**Rule.** Decisions to buy a product, adopt a platform or add a framework must compare it with building the needed functionality. The comparison uses AI-assisted engineering costs, not historical estimates, and includes the full lifetime cost of both options: licenses, integration, operation, upgrades and exit.
**Never built:** database engines, operating systems, anything a regulator requires to be certified, and security primitives ([SEC-10](security.md#sec-10-never-build-your-own-security-primitives)). For these, NATAX uses mature, widely-used implementations.
**Why.** Many products were bought because building the integration yourself was expensive. That assumption often no longer holds, and every product adds a dependency, a contract and a constraint.
**Verified by.** `review`: the decision record must contain both sides of the comparison.

### SIM-04: Use what NATAX already owns, fully
**Rule.** When a capability exists in something NATAX already runs, configure and use it properly before buying something else. Load balancer health checks that understand the application, monitoring that is validated, failure scenarios that are tested and backups that have been restored are all examples.
**Why.** Expensive products used at a fraction of their capability are paid for twice: once at purchase, and again when something else is bought to fill the gap they could have filled.
**Verified by.** `review`.

### SIM-05: One default per need
**Rule.** For each common need, the platform's architecture names one default: one language, one database, one test runner, one way to deploy. Using an alternative requires a decision record.
**Why.** Every alternative doubles the knowledge needed to operate the landscape. Defaults also make agents faster and more predictable.
**Verified by.** `test`, against the technology's approved defaults.

### SIM-06: Build for requirements that exist
**Rule.** Don't build capacity, configurability, abstraction or features for requirements nobody has stated. Resilience, security and capacity for *known* peaks are real requirements; "we might need it someday" is not.
**Why.** Speculative flexibility is paid for forever and is usually wrong about which flexibility will be needed. Changing code later is cheap. Carrying unused complexity is not.
**Verified by.** `review`.

### SIM-07: Temporary complexity has an owner and an end date
**Rule.** Migration shims, feature flags, compatibility layers, parallel runs and architecture exceptions must each have a named owner and a removal date, recorded where the pipeline can find them (`architecture.yaml` or a decision record).
**Why.** "Temporary" is the most permanent state in enterprise IT.
**Verified by.** `test`: the pipeline warns 30 days before a removal date and fails releases of the owning application once it has passed.

### SIM-08: Simplification is normal work
**Rule.** Any change may remove components, dependencies or rules it no longer needs. Agents proposing a change must state what could be removed as well as what is added. The Architecture Board reviews the architecture itself for simplification on a schedule (see [architecture review](../governance/architecture-review.md)).
**Why.** If simplification needs its own program and budget, it never happens.
**Verified by.** `review`.

### SIM-09: Look before you build
**Rule.** Before proposing a new application, the Development Agent checks the [landscape](../landscape/landscape.md) for applications that already solve the problem, or most of it. If there is one, it encourages the Problem Owner to contact that application's owner before anything is built, and helps them prepare the conversation. The outcome is recorded in a decision record, named in `architecture.yaml` under `landscape-check`:

- **Use it:** the existing application already does what's needed. Nothing is built.
- **Extend it:** its owner agrees to add what's missing. The work happens in that application, under its owner.
- **Build anyway:** with a reason the Governance Agent can judge, for example a different user group, different data, or a resilience class the existing application can't offer. "We didn't know it existed" is not a reason, because now we do.
**Why.** The cheapest application is the one that's never built. Two applications doing the same job mean two sets of data that disagree, two Problem Owners, and twice the maintenance. When building becomes this easy, duplicates become the new accumulated complexity, unless someone looks first.
**Verified by.** `test`: `landscape-check` names a decision record that exists. `review`: the Governance Agent checks that the comparable applications in the landscape were considered, and that "build anyway" has a real reason.

## Signs of accidental complexity

The Local Governance Agent and Governance Agent look for these:

- A component that exists to manage another component.
- A framework used for a small fraction of what it does, where the standard library would do.
- Two components doing the same job because nobody dared to remove the old one.
- Configuration options that nobody has ever changed from the default.
- A handover between teams that exists only because one team can't safely change the other's system.
- A design that is explained by its history rather than its requirements.
