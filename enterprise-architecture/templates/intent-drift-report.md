# Intent-drift review: <application>

Reviewer: Local Governance Agent (<model>)
Date: YYYY-MM-DD
Range: <first commit reviewed>..<commit reviewed>
Architecture versions: <from architecture.yaml>

<!--
The whole recorded intent, re-read against the implementation, before a release candidate
(AGT-12; local-governance-agent.md, "The intent-drift review"). Not for quick iterations.

The pipeline reads three things from this file, so keep their form:
- "Range:" above. The second commit is the one you reviewed. If anything changes the recorded
  intent after it (docs/requirements.md, docs/decisions/, docs/escalations/), this report is stale.
- Every in-force ID in the inventory table. One missing is a failure.
- Each finding's "Class:" and "Status:".
You change nothing in the application yourself.
-->

## Inventory

Every item in force: goals and requirements not deprecated or superseded, decisions not superseded, open questions, escalations not answered. One row each.

| ID | What it says, briefly | Status | Evidence |
|---|---|---|---|
| G-1 | | in force | |
| R-001 | | satisfied, tested | test/... |
| R-002 | | satisfied, untested | src/... |
| D-0001 | | finding F-1 | |
| Q-001 | | open | |

Status is one of: satisfied, tested (a test would fail if it broke) · satisfied, untested · finding F-n · open (questions and escalations) · in force (goals, judged through the requests that cite them).

## Findings

### F-1: <short title>
Class: forgotten requirement | contradiction | ambiguity | letter-not-spirit | untested requirement
Items: <IDs, and the rule ID if it's an architecture rule>
Finding: <what is wrong, with the evidence>
Proposed resolution: fix the implementation | deprecate the requirement explicitly | clarify the requirement | propose an architecture change
Status: open | resolved (<how, with the record that resolves it>) | escalated (<link>)

A letter-not-spirit finding against an architecture rule is always escalated, never fixed locally.

## Counts

| | |
|---|---|
| Items in force | 0 |
| Satisfied, with a test that would fail if they broke | 0 |
| Satisfied, without such a test | 0 |
| With findings | 0 |
