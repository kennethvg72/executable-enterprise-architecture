# NATAX

**NATAX (Naturally Aspirated Tax)** writes tax filing software. Its customers are taxpayers filing their own returns, small businesses, and the accounting firms that file on their clients' behalf. NATAX submits the returns electronically to the Tax Authority and tells customers whether they were accepted.

NATAX is fictional. Its problems aren't.

## In numbers

- About 1,200 employees, most of them at headquarters.
- A few million customers, most of whom visit once a year, during the same few weeks.
- One date that matters more than any other: the Tax Authority's **filing deadline, April 30**. Traffic on the last three days before it is roughly ten times an average February day. On deadline day itself, the busiest hour is the last one.

## What's here

This folder is data, not architecture: it describes what NATAX runs today. The pipeline writes it when applications are released, and Central IT for everything older than the pipeline, without a Board decision or a new version. The rules about it are in the architecture ([OWN-08](../principles/ownership.md#own-08-every-application-is-in-the-landscape)).


| File | What it is |
|---|---|
| [landscape.md](landscape.md) | **Every application NATAX has**, what it's for and who to talk to. Read it before building anything ([SIM-09](../principles/simplicity.md#sim-09-look-before-you-build)). |
| [sites.md](sites.md) | DC1 and DC2 (active/active), and HQ, the in-band witness |
| [network.md](network.md) | The address plan, and how traffic flows |
| [landscape.yaml](landscape.yaml) | The machine-readable landscape the tools generate policy and configuration from |
| [accumulated-complexity.md](accumulated-complexity.md) | What NATAX accumulated over twenty years, honestly, and what's being done about each item |
| [workforce-directory.yaml](workforce-directory.yaml) | A stand-in for the workforce directory, for the ownership checks |

## Where things run

| Where | What |
|---|---|
| **DC1** and **DC2** | Everything that touches taxpayer data, active/active ([sites.md](sites.md)) |
| **HQ** | Minimal compute: the third voting site for quorum, and nothing more |
| **Microsoft 365** | Email, documents, Teams, workforce sign-in, and the Power Platform ([power-apps](../../platforms/power-apps/README.md)) |
| **NATAX-managed devices** | Laptops, and Android phones and tablets for staff ([android](../../platforms/android/README.md)) |

## How it got this way

NATAX is twenty years old. Like any organization that age, it has accumulated complexity: a calculation engine nobody dares touch, an integration broker nobody fully understands, a container platform bought for a problem NATAX doesn't have, and load balancers checking that a port is open while the application behind it can't reach its database. These are listed in [accumulated-complexity.md](accumulated-complexity.md), with what's being done about each.
