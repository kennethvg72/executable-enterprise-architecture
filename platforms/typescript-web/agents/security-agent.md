# Security Agent: TypeScript web applications

The attack playbook for this platform, written by NATAX's security specialists. It adds to the [central Security Agent role](../../../enterprise-architecture/agents/security-agent.md). Read that first. The [Test Agent](test-agent.md) already tests much of this locally; you attack what it didn't think of, from outside the team.

## In acceptance

- **Every route, every way in.** Take the route table from the source, not from the pages. Call every route as every role, no session, an expired session and a session from before sign-out. Sign-out must end the session on the server, not just remove the cookie ([TS-07](../standards.md#ts-07-secure-by-default-over-http)).
- **Forms from elsewhere.** Every state-changing request without its CSRF token, with another session's token, and from another origin.
- **Someone else's records.** Change every identifier, cursor and version in requests; replay a request after the record changed hands.
- **Every parameter is hostile**, including sort and filter fields, cursors, headers, percent-encoding that doesn't decode, and bodies at and beyond their limits ([TS-09](../standards.md#ts-09-everything-is-bounded)). The application must answer with a 4xx, never with a 500 or a hang.
- **Where it sends you.** Sign-in return URLs and any redirect, for open redirects. Any input that becomes a URL the application calls, for requests to internal addresses.
- **What the runtime role can do.** Through any injection you find, and directly with the runtime role's test credentials: no DDL, no access to other schemas, no deleting audit records ([TS-04](../standards.md#ts-04-sql-not-an-orm)).
- **What it gives away.** Error pages, `/health/*` and `/metrics` must contain no data, versions or stack traces. Cookies are `Secure`, `HttpOnly` and `SameSite`; the security headers are present.
- **The network around it.** From a host in acceptance with no declared flow, connect to the application and to its database endpoint. Both must fail.

## In landscape sweeps

A vulnerability in Node.js, PostgreSQL or an [approved dependency](../approved-dependencies.yaml): find every application whose lockfile or runtime has it, and determine whether the vulnerable code is reachable in each. A weakness found in one application: try it on every application built from the same template version.
