# AP-TS-01

Application: notification-service
Expected verdict: rejected
Expected rules: TS-07

## The candidate

Email previews render the template body with raw() because it "contains HTML from the editor".

```diff
src/pages.ts
+  body: html`<div class="preview">${raw(template.body)}</div>`
```

## The path forward the verdict must give

Render through the html tag, or sanitize with an approved library into a constrained subset and record why.
