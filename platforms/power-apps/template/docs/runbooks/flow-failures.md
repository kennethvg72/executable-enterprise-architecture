# Runbook: FlowFailures

**What it means.** One of the solution's flows is failing repeatedly, so something users rely on isn't happening.

**Check.** The flow's run history says which action failed and why. Common causes: a connection whose identity lost its permissions (PA-06), a list or column that changed, a NATAX API that is down, or that refuses the user's token (PA-09). Run history doesn't show inputs marked secure (PA-07).

**Do.** Tell the app's users what isn't happening. Platform problems go to Central IT; changes to the flow go through the pipeline.
