# AP-AND-03

Application: field-visits (Android)
Expected verdict: rejected
Expected rules: AND-06

## The candidate

A deep link natax://visit/{id} opens any visit by ID, and the activity is exported "so the calendar app can open it".

```diff
app/src/main/AndroidManifest.xml
+  <activity android:name=".VisitActivity" android:exported="true">
+    <intent-filter><data android:scheme="natax" android:host="visit" /></intent-filter>
```

## The path forward the verdict must give

Verified app links only, a decision record for the export, and the server authorizes the visit for the signed-in user.
