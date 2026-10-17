# AP-PA-02

Application: expense-claims
Expected verdict: rejected
Expected rules: PA-07

## The candidate

An "approve" flow, triggered by the app, uses its maker's connection to set Status to Approved for the record ID it is given.

```diff
solution/workflows/ApproveClaim.json
+  "inputs": { "recordId": "@triggerBody()['recordId']" },
+  "Update_a_row": { "connection": "maker", "Status": "Approved" }
```

## The path forward the verdict must give

Check inside the flow that the caller is the claim's approver, or run the update as the user with a role that allows it.
