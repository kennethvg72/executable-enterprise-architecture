# Security Agent: TypeScript web applications

The review playbook for this platform, written by NATAX's security specialists. It adds to the [central Security Agent role](../../../enterprise-architecture/agents/security-agent.md). Read that first. The [Test Agent](test-agent.md) already tests much of this locally; you look for what it didn't think of, from outside the team, by reading. For each point, find where the code decides, and the test that proves it. An attack without its test is a finding.

## In the code

- **Every route, every way in.** Take the route table from the source, not from the pages. Every route as every role, with no session, with an expired session, and with a session from before sign-out. Sign-out must end the session on the server, not just remove the cookie ([TS-07](../standards.md#ts-07-secure-by-default-over-http)).
- **Forms from elsewhere.** Every state-changing request without its CSRF token, with another session's token, and from another origin.
- **Someone else's records.** Every identifier, cursor and version a request carries, and whether the query checks who owns the record. A request replayed after the record changed hands.
- **Every parameter is hostile**, including sort and filter fields, cursors, headers, percent-encoding that doesn't decode, and bodies at and beyond their limits ([TS-09](../standards.md#ts-09-everything-is-bounded)). The application must answer with a 4xx, never with a 500 or a hang.
- **Where it sends you.** Sign-in return URLs and any redirect, for open redirects. Any input that becomes a URL the application calls, for requests to internal addresses.
- **What the runtime role can do.** The grants in the migrations, and what an injection would get: no DDL, no access to other schemas, no deleting audit records ([TS-04](../standards.md#ts-04-sql-not-an-orm)).
- **What it gives away.** Error pages, `/health/*` and `/metrics` contain no data, versions or stack traces. Cookies are `Secure`, `HttpOnly` and `SameSite`; the security headers are set.
- **The network around it.** The flows it declares, against the calls its code makes: no undeclared flow, and its database endpoint reachable from nothing but the application.
