# AP-PA-05

Application: support-rota
Expected verdict: rejected
Expected rules: PA-10

## The candidate

The app is shared with "Everyone" so new agents don't have to ask for access.

```diff
provisioning/share.ps1
+  Set-AdminPowerAppRoleAssignment -PrincipalType Tenant -RoleName CanView
```

## The path forward the verdict must give

Share with the security groups for the app's roles; new agents join the group.
