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

## Local Governance Agent

Before "Go": is a phone app really needed, or would a web app in the phone's browser do? Does the backend already exist in the [landscape](../../../enterprise-architecture/landscape/landscape.md)? What will be on the device, and for how long? Before "Release": dependencies, permissions, exported components and cached data match their decision records; the backend's `consumes` and `provides` include the app's API at the edge; signing happens only in the pipeline.

## Security Agent

The attack playbook for this platform, written by NATAX's security specialists. It adds to the [central Security Agent role](../../../enterprise-architecture/agents/security-agent.md).

- **The API is the boundary, so attack it without the app.** Call every endpoint of the backend at the edge as every role, with another user's records, with a token issued to another application, with a token from a device that isn't compliant, and as an app version that is too old ([AND-05](../standards.md#and-05-the-app-talks-only-to-natax-apis-by-identity-not-by-network), [AND-12](../standards.md#and-12-old-versions-can-be-retired)).
- **Take the release build apart.** Decompile the signed release: secrets, internal addresses, debug flags, cleartext traffic, and whether it trusts certificates a user installed ([AND-08](../standards.md#and-08-reproducible-builds-and-upload-keys-only-the-pipeline-holds)).
- **Knock on every door.** From another app on the same emulator, start every activity and service, send every broadcast, and open deep links to records the user may not see ([AND-06](../standards.md#and-06-every-way-into-the-app-is-a-door-and-is-locked)).
- **Steal the device.** On a rooted emulator, read the app's storage, backups, logs and clipboard, before and after sign-out, and after the data's age limit ([AND-03](../standards.md#and-03-nothing-on-the-device-that-would-hurt-if-the-device-were-stolen)).

In landscape sweeps: a vulnerability in Android, a library or the identity broker, matched against each app's version catalog and the device fleet's patch levels from device management.
