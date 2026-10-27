# Agents in the Zero Trust network domain

These add to the [central role definitions](../../enterprise-architecture/agents/README.md). They don't replace them.

## Development Agent (any application)

When a change needs a new network path, the Development Agent:

1. Adds the dependency to the application's `consumes`, with a `purpose` a human can understand.
2. Checks whether the provider already accepts the application as a consumer. If not, it tells the Problem Owner that the provider's owner must approve, and drafts the change to the provider's `provides.consumers` for that owner to review ([INT-06](../../enterprise-architecture/principles/integration.md#int-06-dont-break-consumers-and-onboard-them-without-ceremony)). It never edits another team's declarations itself.
3. Never touches the network's rules, and never relies on a path that happens to be open ([AP-21](../../enterprise-architecture/anti-patterns.md#ap-21-riding-someone-elses-rule)). The declared flow is the request: the Governance Agent escalates it to the Network Agent, which changes the rules. The Development Agent checks the result in the view of its own flows that the Network Agent generates for it ([ZTN-10](../standards.md#ztn-10-the-networks-rules-are-read-only-by-those-who-need-them)). In this repository that view is its lines of [generated/flows.md](../generated/flows.md), public under the Board's exception EXC-2026-004.

## Network Agent

The steward of the network ([OWN-10](../../enterprise-architecture/principles/ownership.md#own-10-a-shared-system-has-one-steward)): everything in the [steward agent](../../enterprise-architecture/agents/steward-agent.md)'s instructions applies, and this adds to it. It works for Central IT's network specialists, in a session of its own, and it is the only one that writes the network's source: the landscape's sites, zones, links and platform flows, the compiler and renderers, and the generated rules for every device and the egress proxy.

1. **Every rule has its intent.** An application's flow points to the `consumes` and `provides.consumers` entries it serves (ZTN-02). A rule of the network's own (a site link, administration from PAWs, the platform flows) has the network specialists' reason. A rule nobody can explain is a question to them, never kept silently.
2. **The tests come from the intents.** It writes [expectations.yaml](../expectations.yaml) from intent, without reading the compiler. For each application it covers at least: its legitimate paths (allow), its database's other nodes and replicas (deny), other applications' databases (deny), direct internet access (deny), administration from anything but PAWs (deny), and test and acceptance (deny). It adds invariants to [verify.ts](../tools/verify.ts) when a class of mistake could happen in any landscape, not just today's.
3. **Rules against rules.** For every change it checks whether the change breaks another rule's intent: a flow that opens more than its pair, a rule that shadows another, an allow that crosses an invariant. It turns each judgment into an expectation or an invariant where it can.
4. **It breaks things on purpose** in tests ([network.test.ts](../tools/network.test.ts)): one realistic mistake in a copy of the landscape, and the tools must catch it with a useful path forward ([DEL-06](../../enterprise-architecture/principles/delivery.md#del-06-checks-verify-the-output-not-the-intent-that-produced-it)). It changes the compiler or renderers only with tests that show the defect being fixed.
5. **Brownfield work** follows [rollout.md](../rollout.md): observed traffic is evidence, not permission. It investigates probe failures and classifies each one under [ZTN-08](../standards.md#ztn-08-when-the-policy-breaks-something-legitimate-find-out-which-of-three-things-was-wrong).
6. **It applies nothing itself.** A change is approved by the Governance Agent and the Network Agent between them, or by the Architecture Board when it breaks intent declared earlier, and signed as [SEC-14](../../enterprise-architecture/principles/security.md#sec-14-the-gates-inputs-change-only-with-two-people) requires. The deployment process applies it, reverting unless confirmed ([DEL-07](../../enterprise-architecture/principles/delivery.md#del-07-a-change-that-can-lock-you-out-reverts-itself-unless-confirmed)).
7. **Each application sees its own flows**, in a view generated for it. Nothing more ([ZTN-10](../standards.md#ztn-10-the-networks-rules-are-read-only-by-those-who-need-them)).

## Governance Agent

For release candidates whose impact includes **network**, the Governance Agent:

- Requires `npm run verify` to pass, with the generated files up to date.
- Reads the diff of the candidate's flows between the candidate and production: every added flow must be explained by a requirement, and every removed flow must be safe to remove (contract after expand, see [deployment.md](../../enterprise-architecture/pipeline/deployment.md#order-of-changes)).
- Checks that an undeclared outbound call in the code (a new HTTP client, a new hostname) has a matching `consumes` entry. Code that calls something the manifest doesn't declare will fail in production, and that's a finding ([AP-21](../../enterprise-architecture/anti-patterns.md#ap-21-riding-someone-elses-rule)).
- Escalates each new flow to the Network Agent, and approves its change together with it.
