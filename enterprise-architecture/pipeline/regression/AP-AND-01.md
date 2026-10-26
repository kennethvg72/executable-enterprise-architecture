# AP-AND-01

Application: field-visits (Android)
Expected verdict: rejected

## The candidate

The app hides "approve visit" for non-managers; the backend's approve endpoint accepts any valid workforce token.

```diff
backend/src/app.ts
+  router.post('/api/visits/:id/approve', auth.protectApi(['user'], approve));
```

## The path forward the verdict must give

The backend requires the manager role for approval and accepts only the app's own client ID.
