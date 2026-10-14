# Android

The architecture for Android apps for NATAX staff: people who work away from a desk, or who need the device itself (the camera, a scanner, working offline). Customers use NATAX's web applications in their phone's browser; a customer app would be a separate platform, proposed when someone needs one.

Version: [VERSION](VERSION). Limits: [platform.yaml](platform.yaml). Governed by the [central architecture](../../enterprise-architecture/README.md), and the always-applied [network](../../network/README.md) and [infrastructure](../../infrastructure/README.md) architectures.

## In one minute

- **Managed devices only**, compliant (screen lock, encryption, patched, not rooted), with private apps from managed Google Play ([AND-01](standards.md#and-01-managed-devices-private-apps-compliance-checked)).
- **The device is not trusted storage.** No secrets in the app; no Taxpayer-Restricted data on the device; Confidential data only sealed with a Keystore key, only as long as needed, erased on sign-out ([AND-03](standards.md#and-03-nothing-on-the-device-that-would-hurt-if-the-device-were-stolen)).
- **Sign-in through the IdP's broker**, so a non-compliant device can't sign in ([AND-04](standards.md#and-04-sign-in-with-the-workforce-idps-broker-so-device-compliance-counts)).
- **A client and nothing more.** The app talks only to NATAX APIs at the edge, with the user's token. Its backend is a service on the [typescript-web](../typescript-web/README.md) platform ([AND-05](standards.md#and-05-the-app-talks-only-to-natax-apis-by-identity-not-by-network)).
- **Every way into the app is locked**: no exported components, verified deep links ([AND-06](standards.md#and-06-every-way-into-the-app-is-a-door-and-is-locked)).
- **Offline-first, and the server is always right** ([AND-07](standards.md#and-07-offline-first-and-the-server-is-always-right)).

An Android app is almost always two applications: the app, and its backend API. Both have an `architecture.yaml`, both are in the [landscape](../../enterprise-architecture/landscape/landscape.md), and both go through the pipeline. The backend is published at the edge for managed devices (`exposure: staff-edge`), so it needs a Technical Owner. Check the landscape first: the backend may already exist as a NATAX API.

## What's here

| | |
|---|---|
| [standards.md](standards.md) | The rules for this platform (AND-xx) |
| [platform.yaml](platform.yaml) | The limits the pipeline enforces, its checks, and the evidence it needs |
| [approved-dependencies.yaml](approved-dependencies.yaml) | The approved libraries |
| [BOOTSTRAP.md](BOOTSTRAP.md) | Setting up to build an Android app |
| [agents/](agents/README.md) | What the agents do differently on this platform |
| [template/](template/) | The repository layout |

## What isn't runnable here

This repository contains no Android SDK or emulator. The rules, the limits and the manifest checks are real and enforced. The Gradle checks run wherever the project and the Android SDK are available, and the pipeline reports them as skipped elsewhere, never as passed. A skipped check leaves the pipeline's result incomplete, which blocks a release like a failure.
