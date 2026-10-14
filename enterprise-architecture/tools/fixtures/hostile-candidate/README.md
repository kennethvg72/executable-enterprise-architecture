# The hostile canary

A release candidate whose tests try to escape the pipeline's runner ([SEC-13](../../../principles/security.md#sec-13-the-pipeline-treats-every-release-candidate-as-hostile)). Each test is one escape attempt, and passes only if the attempt fails:

| Attempt | The runner must... |
|---|---|
| Find credentials in the environment | Provide none, except the run's own test database |
| Read credential files (SSH keys, Git, npm, cloud and cluster credentials) | Have none to read |
| Write outside the workspace, including into the architecture | Make the workspace the only writable place |
| Leave a marker for the next run | Be destroyed after each run |
| Reach the internet | Allow no network except the package mirror and the test database |
| Reach production | Allow no route to production at all |

The canary records whether an attempt succeeded, never what it found: names, not contents.

Run it with [verify-runner.ts](../../verify-runner.ts), inside the runner, on every change to the runner's configuration and weekly. Run anywhere else, it shows what a release candidate could do there.

The Security Agent extends it whenever it finds a new way out.
