# Observed traffic compared with declared intent

Observed traffic is evidence, not permission. Undeclared flows are questions for the owners of both ends, not automatic additions to the policy. Some are not questions at all: the architecture forbids them.

## Forbidden: will be blocked, with a path forward (2)

| From | To | Port | Connections | Note |
|---|---|---|---|---|
| data-warehouse 10.1.20.91 | platform-lb → core-db 10.1.50.10 | 5433 | 880 | INT-01: only the owning application uses its database. Path forward: get the data through the owning application's API, or ask its owner for a read-only API for this need. |
| zone:workforce 10.3.101.17 | app-db 10.1.30.31 | 5432 | 12 | RES-05: database nodes are reached only through the database endpoint. Path forward: connect through the endpoint on platform-lb, as the owning application. |

## Undeclared: needs a decision (1)

| From | To | Port | Connections | Note |
|---|---|---|---|---|
| customer-idp 10.1.20.61 | returns-service 10.1.20.71 | 8443 | 40 | Ask customer-idp (central-it) and returns-service (consumer-filing): is this needed? If yes, declare it on both sides. If not, it will be blocked. |

## Unknown addresses: investigate (1)

| From | To | Port | Connections | Note |
|---|---|---|---|---|
| calc-engine 10.1.20.21 | ? 10.1.20.99 | 8080 | 45 | 10.1.20.99 isn't in the landscape. Find out what it is: an inventory gap is a security gap. |

## Declared (10)

| From | To | Port | Connections | Note |
|---|---|---|---|---|
| rejection-triage 10.1.20.31 | platform-lb → app-db 10.1.50.10 | 5432 | 15230 | Stores triage state. |
| rejection-triage 10.1.20.31 | efile-gateway 10.1.20.41 | 8444 | 3201 | Reads new rejections. If it is down, the existing queue still works (RES-07). |
| rejection-triage 10.1.20.31 | egress-proxy 10.1.50.30 | 3128 | 412 | rejection-triage to workforce-idp through the egress proxy |
| filing-web 10.1.20.11 | returns-service 10.1.20.71 | 8443 | 982113 | filing-web uses returns-service api |
| filing-web 10.1.20.11 | calc-engine 10.1.20.21 | 8443 | 1204551 | filing-web uses calc-engine api |
| advisor-portal 10.1.25.201 | calc-engine 10.1.20.21 | 8443 | 210334 | advisor-portal uses calc-engine api |
| efile-gateway 10.1.20.41 | integration-broker 10.1.20.81 | 5671 | 90211 | Publishes acknowledgements (legacy) |
| notification-service 10.1.20.51 | egress-proxy 10.1.50.30 | 3128 | 61022 | notification-service to email-provider through the egress proxy |
| app-db 10.1.30.31 | app-db 10.2.30.31 | 5432 | 1 | Synchronous replication to the other datacenter |
| etcd-quorum 10.3.70.21 | etcd-quorum 10.1.30.21 | 2380 | 20160 | Raft consensus between the three sites |

