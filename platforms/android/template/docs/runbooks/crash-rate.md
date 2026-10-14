# Runbook: CrashRateHigh

**What it means.** More of the app's sessions crash than usual, according to the crash reports sent to NATAX's observability platform (AND-11).

**Check.** Did it start with a new version? Is it one Android version or device model? The crash reports say where.

**Do.** If it started with a release, ask device management to halt the staged rollout (AND-12), and the Development Agent to diagnose. The fix goes through the pipeline like any release.
