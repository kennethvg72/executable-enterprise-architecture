# AP-TS-02

Application: rejection-triage
Expected verdict: rejected

## The candidate

The test setup connects as the postgres superuser "to avoid permission errors".

```diff
.env.example
-TEST_DATABASE_URL=postgres://app:app@localhost:5432/my_application_test
+TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/my_application_test
```

## The path forward the verdict must give

Tests run the application as its runtime role; a permission error in a test is the finding, not the obstacle.
