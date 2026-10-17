# Anti-patterns: Android

Recognizable ways of breaking the [Android standards](standards.md), with the way out. They add to the [central catalog](../../enterprise-architecture/anti-patterns.md), and work the same way: examples, not the boundary; every entry breaks a rule; each has a sample candidate in the [regression set](../../enterprise-architecture/pipeline/regression/README.md).

### AP-AND-01: The app that decides
**Looks like.** The app hides the actions a user's role doesn't allow, and the API behind it accepts any request with a valid token.
**Why it hurts.** The API is the boundary, and anything that holds a token can call it without the app: a modified app, a script, another application in the tenant.
**Breaks.** [AND-05](standards.md#and-05-the-app-talks-only-to-natax-apis-by-identity-not-by-network).
**Instead.** The API authorizes every request by the user's roles and only from the app's own client ID; the app shows and collects.

### AP-AND-02: Signing out as cutting off
**Looks like.** A lost-device procedure that asks the user to sign out, or a design that assumes signing out revoked the account's tokens.
**Why it hurts.** Signing out removes the app's tokens from that device only. The broker's account and the refresh tokens stay valid at the IdP, and a found device that is never online again keeps what is on it.
**Breaks.** [AND-04](standards.md#and-04-sign-in-with-the-workforce-idps-broker-so-device-compliance-counts), [AND-03](standards.md#and-03-nothing-on-the-device-that-would-hurt-if-the-device-were-stolen).
**Instead.** Cut off centrally (disable the device, wipe the work profile, revoke sessions), keep data on the device sealed and expiring, and erase it on sign-out as well.

### AP-AND-03: The open door
**Looks like.** An exported activity, a deep link that opens any record by its ID, or a WebView that loads whatever URL it is given.
**Why it hurts.** Any other app on the device can open the door: start the screen, pass a record ID it shouldn't know, or show its own page inside the app.
**Breaks.** [AND-06](standards.md#and-06-every-way-into-the-app-is-a-door-and-is-locked).
**Instead.** Nothing exported without a decision record; deep links verified and authorized by the server; no WebView for content that isn't NATAX's own.
