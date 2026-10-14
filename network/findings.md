# Findings

When the network policy blocks something legitimate, or a check finds the policy or its tools are wrong, the cause is classified and recorded here ([ZTN-08](standards.md#ztn-08-when-the-policy-breaks-something-legitimate-find-out-which-of-three-things-was-wrong)): was the **implementation** wrong, were the **requirements** incomplete, or does the **architecture** need to improve?

## 2026-10-14: Every dropped packet was logged

**Classification:** implementation wrong.

**What happened.** The Architecture Board's review of the generated rulesets found that drops were written as `log prefix "…" limit rate 10/second drop`. nftables evaluates statements left to right, so every dropped packet was logged and only the drop was rate-limited. Under a scan or a misconfigured client, that floods the logs. The intent, in ZTN-03, was "logs drops at a limited rate".

**Fix.** The renderer now generates `limit rate 10/second log prefix "…"` and lets the chain's policy drop the packet. A test checks the order ([network.test.ts](tools/network.test.ts)). Because policy is generated, the fix reached every host's ruleset at once.

**Lesson.** Rules generated from intent can still be wrong, but they are wrong in one place, and fixed in one place.

## 2026-10-14: customer-idp calls returns-service

**Classification:** requirements incomplete (to be confirmed).

**What happened.** The flow log analysis ([report](observed/flowlog-sample-report.md)) shows customer-idp connecting to returns-service's API, which neither declares. It isn't forbidden by any rule, so it's a question for the owners of both ends.

**Status.** Asked Central IT (customer-idp) and Consumer Filing (returns-service) on 2026-10-14. If it's needed (likely: the sign-in pages show whether a return is in progress), both sides declare it. If not, the policy will block it when enforcement starts ([rollout.md](rollout.md)).
