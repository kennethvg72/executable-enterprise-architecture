# Identity and access (IAM)

At NATAX, identity replaces location as the basis for trust. Every person, device and workload has an identity, and every access decision is made against it.

## The identity providers

| Identity provider | Who | Protocol |
|---|---|---|
| **Workforce IdP** (SaaS) | Employees and contractors | OIDC, SAML for legacy only |
| **Customer IdP** (runs in DC1 and DC2) | Taxpayers and accounting firms | OIDC |
| **Workload identity** (issued by the internal certificate authority) | Services, jobs, the pipeline | Short-lived X.509 certificates (mTLS) |
| **SSH certificate authority** | Just-in-time administrative sessions | SSH certificates, valid for at most 60 minutes |

### IAM-01: Workforce and customer identities never mix
**Rule.** Internal applications accept only workforce identities, including staff APIs published at the edge for NATAX-managed devices (`staff-edge`). Customer-facing applications accept only customer identities. No application accepts both. No identity is linked or federated between the two providers: an employee who also files their taxes with NATAX has two unrelated accounts.
**Why.** Mixing them means a phished taxpayer account could become a way in. It also makes it impossible to reason about who an application is for.
**Verified by.** `test`: each application's `architecture.yaml` declares one identity provider in `users`. The pipeline checks the application's OIDC configuration against it.

### IAM-02: Applications don't handle passwords
**Rule.** Applications authenticate users through OIDC (authorization code flow with PKCE) against the right identity provider. They never see, store or check passwords. Sessions are server-side, cookies are `HttpOnly`, `Secure` and `SameSite=Lax` or stricter, and session lifetime follows the identity provider's policy.
**Why.** Password handling is a specialty. One provider doing it well beats every application doing it adequately.
**Verified by.** `test`: configuration checks. `review`.

### IAM-03: Phishing-resistant authentication
**Rule.** Workforce and accounting-firm accounts use phishing-resistant factors: FIDO2 security keys or passkeys. Taxpayer accounts require multi-factor authentication, with passkeys offered first. Codes sent by SMS or email aren't accepted for workforce accounts.
**Why.** Phishing is how most intrusions start. A factor bound to the website's origin defeats it.
**Verified by.** `test`: identity provider policy.

### IAM-04: Authorization is explicit, server-side and deny-by-default
**Rule.** Every request is authorized on the server; anything not explicitly allowed is denied.

- **Internal applications** define their roles in `architecture.yaml` and in code. Roles are assigned through workforce IdP groups, never inside the application. Group membership for roles that grant access to *Confidential* data or higher is reviewed by the Problem Owner every 90 days, and unreviewed memberships expire.
- **Customer-facing applications** also authorize every request against the record itself: a taxpayer reaches only their own filings, and an accounting firm only its own clients'.

**Why.** Hidden buttons aren't access control. Access granted in an application's own user table is invisible to everyone else and is never removed. And for a tax platform, one customer reaching another's records by changing an ID in a URL is the most likely serious flaw.
**Verified by.** `test`: the Test Agent's authorization tests (every endpoint, every role, including "no role", and other customers' records). IdP group expiry is enforced by the IdP.

### IAM-05: Every workload has its own identity
**Rule.** Every service instance authenticates with its own workload certificate, issued automatically and valid for at most 24 hours. Service-to-service calls use mutual TLS, and the receiving service checks the caller's identity against its declared consumers. Internal load balancers pass service-to-service TLS through, so the receiver sees the caller's certificate. Static API keys between services aren't allowed.
**Why.** This is Zero Trust at the application layer. The network policy ([network](../../network/README.md)) limits *which hosts* can connect; workload identity proves *which service* is connecting. Each covers the other's failure modes.
**Verified by.** `test`: certificate configuration and lifetime checks. Each application's tests reject callers that aren't declared consumers.

### IAM-06: Human administrative access is just-in-time and direct
**Rule.** By default, nobody logs in to production (see [SEC-01](security.md#sec-01-only-the-central-pipeline-changes-production)). When a human must, for example to investigate an incident the pipeline can't diagnose:

1. The access is requested for a specific target and reason, and approved by a second person.
2. It is made from a **privileged access workstation (PAW)**: a managed, hardened device used for nothing else, identified by its device certificate.
3. It uses an **SSH certificate** issued for that person and that target, valid for at most 60 minutes. The session ends when the certificate expires. No passwords or long-lived keys exist, other than the sealed break-glass credentials below.
4. The connection goes **directly from the PAW to the target**. There are no jump hosts or bastion servers: no intermediate system ever holds or relays administrative credentials.
5. The session is recorded and streamed off the target as it happens, to the central log store.
6. Any change made during the session is an incident. It is brought into the versioned sources and deployed through the pipeline before the next daily drift run, which would otherwise revert it ([DEL-04](delivery.md#del-04-infrastructure-and-network-are-code)).

**Break-glass.** If the access system itself is down, sealed break-glass credentials exist for each platform. Opening them alerts the security team immediately and requires a post-incident review.
**Why.** A jump host concentrates every administrator's credentials and sessions in one place. Whoever compromises it collects them all. Short-lived, narrowly scoped credentials, used directly from trusted devices, leave nothing worth stealing.
**Verified by.** `test`: SSH daemons accept only certificates from the NATAX SSH CA, and network policy allows administrative ports only from PAW networks. Both are checked by the [network](../../network/README.md) tests.

### IAM-07: Every action on sensitive data is attributable
**Rule.** Applications record who did what to *Confidential* or *Taxpayer-Restricted* data, and when: user identity, action, record reference and timestamp. Each application lists its audited actions. The application's own database role can insert audit records but can't update or delete them.
**Why.** When something goes wrong with taxpayer data, the first question is always "who?". "The application" is not an answer.
**Verified by.** `test`: the Test Agent verifies that each audited action produces an audit record, and that the application's role can't change or delete one.
