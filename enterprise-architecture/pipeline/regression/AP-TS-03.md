# AP-TS-03

Application: returns-service
Expected verdict: rejected
Expected rules: DAT-07

## The candidate

One release renames returns.tax_year to returns.fiscal_year and updates the code to use the new name.

```diff
migrations/0012_rename.sql
+  ALTER TABLE returns RENAME COLUMN tax_year TO fiscal_year;
```

## The path forward the verdict must give

Add fiscal_year and write both; switch reads; drop tax_year in a later release.
