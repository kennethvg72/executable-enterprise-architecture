# AP-AND-02

Application: field-visits (Android)
Expected verdict: rejected

## The candidate

The lost-phone runbook says: "Ask the user to sign out on another device; this revokes the phone's access."

```diff
docs/runbooks/lost-device.md
+  1. Ask the user to sign out from the app on another device.
```

## The path forward the verdict must give

Central IT disables the device in Entra ID, wipes the work profile and, if needed, revokes the user's sessions; data on the device is sealed and expires.
