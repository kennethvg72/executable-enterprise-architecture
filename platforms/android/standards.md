# Android standards (AND)

How NATAX builds Android apps for its staff. These rules implement the [central principles](../../enterprise-architecture/README.md) and the always-applied [network](../../network/README.md) and [infrastructure](../../infrastructure/README.md) architectures for apps that run on phones and tablets; where a central rule works differently here, [platforms/README.md](../README.md#central-rules-that-work-differently-per-platform) says how. They add to the central rules, and never relax them.

The essential difference from the other platforms: **the device is not NATAX's datacenter**. Even a managed phone gets lost, left in a taxi, and run on hostile networks. Anything in the app (code, configuration, data) can be read by whoever holds it. So the app is a client and nothing more: the truth, the secrets and the rules live on the server.

**Staff only.** Android 1.0 is for NATAX staff on NATAX-managed devices ([platform.yaml](platform.yaml)). Customers use NATAX's web applications in their phone's browser. A customer app would be a different platform, with different threats, proposed to the Board when someone needs one.

### AND-01: Managed devices, private apps, compliance checked
**Rule.** Apps are installed only on NATAX-managed devices (Android Enterprise: fully managed, or a work profile), as private apps published to NATAX's organization through managed Google Play, configured through managed configurations from device management. Never sideloaded. Device management enforces, and reports to the workforce IdP as compliance: a screen lock, device encryption, a supported Android version (12 or later) with security patches no older than 90 days, and no rooted device or unlocked bootloader. A non-compliant device can't sign in (AND-04). Device management wipes the work profile when a device is reported lost or its user leaves; because a wipe only reaches a device when it's online, cached data also expires on its own (AND-03).
**Why.** An app on an unmanaged or rooted phone is an app NATAX can't update, configure, trust, or wipe.
**Verified by.** `test`: the pipeline publishes only as a private app to NATAX's organization. Device compliance policy is Central IT's, checked daily.

### AND-02: Kotlin, Compose, few dependencies, locked versions
**Rule.** Apps are written in Kotlin, with Jetpack Compose for the user interface, targeting Android 12 (API 31) or later. Dependencies come from [approved-dependencies.yaml](approved-dependencies.yaml); anything else needs a decision record ([SIM-01](../../enterprise-architecture/principles/simplicity.md#sim-01-every-component-must-earn-its-place)). Versions are declared once, in the version catalog (`gradle/libs.versions.toml`), locked with Gradle dependency locking, and resolved only from NATAX's approved repository mirror.
**Why.** Android projects collect libraries fast, and every library runs with the app's permissions, on the user's device. The platform and AndroidX cover most needs.
**Verified by.** `test`: the version catalog against the approved list; dependency verification and locking in every build (AND-08).

### AND-03: Nothing on the device that would hurt if the device were stolen
**Rule.**
- **No secrets in the app**: no API keys, client secrets or passwords in code, resources or configuration. Everything in an APK can be extracted.
- **No Taxpayer-Restricted data on the device**, ever, not even in a cache.
- **Confidential data** is kept only when the task needs it offline (AND-07), and for no longer than the `device` store's retention in `architecture.yaml`. It is **encrypted before it's written**: values are sealed with AES-GCM under a key held in the Android Keystore, so the database, its journal, its write-ahead log and any files only ever contain ciphertext. There is no plaintext fallback: if the key is unavailable, the data is unreadable and the app fetches it again. Queued commands (AND-07) are treated the same way.
- **Signing out, or an account change, erases**: the app deletes the Keystore key (which makes everything sealed with it unreadable), deletes the data, and cancels queued work. Expiry is enforced when data is read and when the app starts, not only by background jobs, which Android may postpone.
- **Nothing leaks around the side**: backups and device-to-device transfers exclude the app's data and tokens (`android:allowBackup="false"` and `dataExtractionRules`); screens showing Confidential data set `FLAG_SECURE`; copying Confidential values to the clipboard is off unless a requirement says otherwise, and then marked sensitive; notifications don't contain Confidential data; release builds are not debuggable and never log tokens, request bodies or Confidential values.

**Why.** A lost phone must be an inconvenience, not a data breach.
**Verified by.** `test`: the Test Agent's tests on the emulator (sign-out erases, expired data unreadable, backup excluded); inspection of the merged release manifest and the release APK for secrets, `debuggable` and backup settings (required evidence in [platform.yaml](platform.yaml)). `review`: what is cached, and why.

### AND-04: Sign-in with the workforce IdP's broker, so device compliance counts
**Rule.** Staff sign in with the workforce IdP (Microsoft Entra ID), through the Microsoft Authentication Library with broker integration: the authenticator app the device management installs handles sign-in, and conditional access checks the device's compliance (AND-01) before issuing a token ([IAM-02](../../enterprise-architecture/principles/identity-and-access.md#iam-02-applications-dont-handle-passwords), [IAM-03](../../enterprise-architecture/principles/identity-and-access.md#iam-03-phishing-resistant-authentication)). Sign-in never happens in a WebView inside the app, and the app never asks for a password. The redirect URI is registered exactly, for the app's signing certificate. Tokens are kept by the broker or sealed as in AND-03. Signing out removes the app's tokens from the device and erases its data (AND-03), but revokes nothing at the IdP: the broker's account and the refresh tokens stay valid there. So a lost device is cut off centrally: Central IT disables the device in Entra ID, which revokes its refresh tokens and fails conditional access, wipes the work profile through device management, and revokes the user's sessions if the account may be compromised. An access token already issued stays valid at NATAX APIs until it expires (about an hour), because continuous access evaluation doesn't cover NATAX's own APIs; local data expiry (AND-03) covers a device that stays offline.
**Why.** A generic OIDC library can sign the user in, but can't prove the device is managed and compliant; the IdP's broker can, which is what makes AND-01's checks count at sign-in. An embedded login page teaches users to type their password into any app that asks, and lets the app see it.
**Verified by.** `test`: the Test Agent's tests with an unmanaged device, a non-compliant device and a disabled device: each must fail to get a token, and a revoked session must fail once its access token expires. `review`: the lost-device procedure is in the app's runbook.

### AND-05: The app talks only to NATAX APIs, by identity, not by network
**Rule.** The app calls only NATAX APIs, published at the internet edge for staff on managed devices (`exposure: staff-edge` in the API's `architecture.yaml`), with the user's access token. Those APIs are services on the [typescript-web](../typescript-web/README.md) platform (an app's own backend, or an existing NATAX API), and they authorize every request themselves ([IAM-04](../../enterprise-architecture/principles/identity-and-access.md#iam-04-authorization-is-explicit-server-side-and-deny-by-default)). A `staff-edge` API accepts only workforce tokens issued to compliant devices, and has a Technical Owner ([OWN-03](../../enterprise-architecture/principles/ownership.md#own-03-citizen-developed-applications-have-limits)), because it is reachable from the internet. There is no VPN into NATAX for apps, no direct connection to a database, and no third-party service in between. Cleartext traffic is disabled.
**Why.** This is Zero Trust for devices: being on a VPN or a managed device grants nothing by itself ([SEC-02](../../enterprise-architecture/principles/security.md#sec-02-nothing-is-trusted-because-of-where-it-is)). The API, with the user's identity and the device's compliance, decides. A backend also keeps the rules in one place, instead of in every installed copy of the app.
**Verified by.** `test`: the API's own network policy and authorization tests; validate-manifest checks `staff-edge` APIs use the workforce IdP and have a Technical Owner. `review`: every host the app calls is in its `consumes`.

### AND-06: Every way into the app is a door, and is locked
**Rule.**
- Activities, services, receivers and content providers are **not exported**, unless a decision record says why one must be. An exported component validates its caller and every input ([SEC-06](../../enterprise-architecture/principles/security.md#sec-06-all-input-is-hostile)).
- Intents that carry Confidential data name their destination explicitly, and grant the narrowest URI permissions, for the shortest time.
- **Deep links** are verified App Links for NATAX's domains. Opening one never skips sign-in or authorization: the app checks the user may see what the link points to.
- **WebViews** are used only for NATAX's own content, restricted to its hosts, with JavaScript off unless a decision record says why, and never for sign-in (AND-04).

**Why.** Permissions (AND-10) control what the app can do to the device. Exported components, intents and deep links control what *other apps* can do to this one. They are the app's attack surface.
**Verified by.** `test`: lint, and an inspection of the merged manifest for exported components without a decision record. `review`.

### AND-07: Offline-first, and the server is always right
**Rule.** Apps for people who work away from a desk keep working without a network:

- Changes made offline are stored as **commands** in a local queue (Room), sealed as in AND-03, each with an idempotency key, and sent by a background worker (WorkManager) with exponential backoff when the network is back ([INT-04](../../enterprise-architecture/principles/integration.md#int-04-every-call-expects-failure)).
- The **server is the system of record**. It decides every command; when a command conflicts with a change made meanwhile, the server's decision stands, and the app tells the user what happened. The app never merges silently.
- The app shows how old its data is, and refuses to act on data older than the limit the Problem Owner sets ([RES-07](../../enterprise-architecture/principles/resilience.md#res-07-degrade-visibly-instead-of-failing-completely)). Signing out cancels queued work (AND-03).

**Why.** "No network" is a normal condition on a phone, not an error. And an offline-first app that merges silently will lose someone's work.
**Verified by.** `test`: the Test Agent's tests for offline changes, conflicts, duplicates, expired data and sign-out with queued work (AND-09).

### AND-08: Reproducible builds, and upload keys only the pipeline holds
**Rule.** Builds use the Gradle wrapper (`gradlew`, or `gradlew.bat` on Windows), with dependency verification (`gradle/verification-metadata.xml`, reviewed when it changes) so every dependency's checksum is checked on every build ([SEC-05](../../enterprise-architecture/principles/security.md#sec-05-dependencies-are-pinned-sourced-and-scanned)). Release builds are minified with R8. The app signing key is held by Play App Signing; the upload key is in the secret store and used only by the pipeline, which builds, signs and publishes. Debug builds on developers' machines and emulators use throwaway debug keys, which can't publish anything.
**Why.** Whoever holds the upload key can publish an update that every managed device installs. That's production access ([SEC-01](../../enterprise-architecture/principles/security.md#sec-01-only-the-central-pipeline-changes-production)).
**Verified by.** `test`: the build fails on a checksum mismatch; publishing happens only in the pipeline.

### AND-09: Tests run on emulators, in the pipeline
**Rule.** Every app has unit tests (JVM) and UI tests (Compose), written by the Test Agent, and the pipeline runs them on Gradle managed devices for the oldest and newest Android versions the app supports, and checks that the tests actually ran. The tests cover the offline cases (AND-07), sign-in refusal (AND-04), sign-out erasing data (AND-03), denied permissions (AND-10), deep links (AND-06), and the backend being down or slow. Lint warnings about security fail the build.
**Why.** "It worked on my phone" covers one device, one Android version, and a perfect network.
**Verified by.** `test`: `./gradlew check` and `./gradlew allDevicesCheck` in the pipeline ([platform.yaml](platform.yaml)).

### AND-10: Every permission is a decision
**Rule.** Each Android permission the app requests (camera, location, contacts and so on) is named and justified in a decision record, like a dependency. It's requested at the moment it's needed, with an explanation, and the app works, in a reduced way, if it's refused.
**Why.** Permissions are what the app can do to the user's device and data. The fewer, the safer, and the more people trust it.
**Verified by.** `test`: the merged manifest's permissions against the decision records (required evidence). `review`.

### AND-11: Observability goes to NATAX, not to third parties
**Rule.** Crash reports, errors and usage metrics go to NATAX's observability platform, through a NATAX API, without personal or Confidential data ([OBS-01](../../enterprise-architecture/principles/observability.md#obs-01-logs-are-structured-central-and-clean)). No third-party analytics, advertising or crash-reporting SDKs. The app has at least one alert: its crash rate ([OBS-04](../../enterprise-architecture/principles/observability.md#obs-04-every-alert-has-an-owner-and-a-runbook)).
**Why.** A third-party SDK sends data from NATAX's app to someone else, under someone else's terms. It's also a dependency NATAX can't inspect (AND-02).
**Verified by.** `test`: the dependency check; the alert in `architecture.yaml`.

### AND-12: Old versions can be retired
**Rule.** The backend declares the oldest app version it accepts. Older versions get a clear "please update" response, never a failure halfway through a task. Device management installs updates automatically. A new version is rolled out in stages, and the rollout stops if the crash rate rises. An API change that breaks an app version still in use follows [INT-06](../../enterprise-architecture/principles/integration.md#int-06-dont-break-consumers-and-onboard-them-without-ceremony): the old version keeps working until it's retired.
**Why.** Unlike a web app, old versions of a mobile app stay in use until they're updated. The server must be able to say "no longer", politely.
**Verified by.** `test`: the backend's tests include a too-old client.
