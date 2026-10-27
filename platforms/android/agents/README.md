# Agents on the Android platform

These add to the [central role definitions](../../../enterprise-architecture/agents/README.md).

## Development Agent

- **Design the server side first.** What does the API offer, who may do what, and what does the server decide ([AND-05](../standards.md#and-05-the-app-talks-only-to-natax-apis-by-identity-not-by-network))? The app then shows and collects; it doesn't decide.
- **Decide what the app may keep on the device, and for how long,** with the Problem Owner, in their terms: *"If a phone is lost, the finder couldn't read anything, but if it's never found, yesterday's list of visits stays on it, encrypted, until it expires tomorrow. Is that acceptable?"* ([AND-03](../standards.md#and-03-nothing-on-the-device-that-would-hurt-if-the-device-were-stolen)).
- **Make offline work explicit** ([AND-07](../standards.md#and-07-offline-first-and-the-server-is-always-right)): which actions work offline, how old data may be, what the user sees when the server says no.
- **Keep the doors shut** ([AND-06](../standards.md#and-06-every-way-into-the-app-is-a-door-and-is-locked)): nothing exported, deep links verified, no WebView for anything that isn't NATAX's own content.
- **Every permission and every dependency gets a decision record** ([AND-10](../standards.md#and-10-every-permission-is-a-decision), [AND-02](../standards.md#and-02-kotlin-compose-few-dependencies-locked-versions)).

## Test Agent

- Tests offline behavior on the emulator: airplane mode mid-task, conflicting changes, duplicate submissions after a retry, data past its age limit, sign-out with work still queued.
- Tests sign-in: an unmanaged device, a non-compliant device, expired and revoked tokens, and that signing out erases cached data.
- Tests the doors: launching every activity from another app, opening deep links to records the user may not see.
- Inspects the release build: no secrets, not debuggable, backups excluded, no cleartext, nothing exported without a reason.
- Tests the backend separately, on its own platform, including a client version that's too old ([AND-12](../standards.md#and-12-old-versions-can-be-retired)).
- Records the evidence [platform.yaml](../platform.yaml) names, with `record-evidence.ts`, on the committed code: `test-results` (`./gradlew check`) and `device-tests` (`./gradlew allDevicesCheck`). Gradle's output isn't counted, so the audit checks the command, the commit and the exit code ([DEL-02](../../../enterprise-architecture/principles/delivery.md#del-02-tests-are-part-of-the-change)).

## Local Governance Agent

Before "Go": is a phone app really needed, or would a web app in the phone's browser do? Does the backend already exist in the [landscape](../../../enterprise-architecture/landscape/landscape.md)? What will be on the device, and for how long? Before "Release": dependencies, permissions, exported components and cached data match their decision records; the backend's `consumes` and `provides` include the app's API at the edge; signing happens only in the pipeline.

## Security Agent

The review playbook for this platform, written by NATAX's security specialists. It adds to the [central Security Agent role](../../../enterprise-architecture/agents/security-agent.md). You read the source and the Test Agent's tests; you run nothing. An attack without its test is a finding.

- **The API is the boundary, so read it without the app.** Every endpoint of the backend at the edge, as every role, with another user's records, with a token issued to another application, with a token from a device that isn't compliant, and as an app version that is too old ([AND-05](../standards.md#and-05-the-app-talks-only-to-natax-apis-by-identity-not-by-network), [AND-12](../standards.md#and-12-old-versions-can-be-retired)).
- **What the release build would contain.** The build configuration, the manifest and the resources: secrets, internal addresses, debug flags, cleartext traffic, and whether it trusts certificates a user installed ([AND-08](../standards.md#and-08-reproducible-builds-and-upload-keys-only-the-pipeline-holds)). The Test Agent's inspection of the release build is its evidence.
- **Every door.** Every activity, service, broadcast receiver and deep link in the manifest and the code: what another app on the device could start, send or open, and the tests that try it ([AND-06](../standards.md#and-06-every-way-into-the-app-is-a-door-and-is-locked)).
- **A stolen device.** What the app keeps in storage, backups, logs and the clipboard, before and after sign-out, and after the data's age limit, and the tests that check it on a rooted emulator ([AND-03](../standards.md#and-03-nothing-on-the-device-that-would-hurt-if-the-device-were-stolen)).
