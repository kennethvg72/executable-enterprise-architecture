# AP-PA-03

Application: equipment-loans
Expected verdict: rejected

## The candidate

Loan records are exported to an Excel file on OneDrive; the design says "OneDrive is blocked by the DLP policy, so it can't leave the tenant".

```diff
architecture.yaml
+    connectors: [SharePoint, Excel Online (Business), OneDrive for Business]
```

## The path forward the verdict must give

Use only the allowed connectors under the advanced connector policy; data permissions must hold even when a connector is available.
