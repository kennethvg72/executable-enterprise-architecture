# AP-PA-04

Application: expense-claims
Expected verdict: rejected
Expected rules: PA-04

## The candidate

The search box filters claims with a non-delegable Search() over a table that grows by 3,000 rows a month.

```diff
solution/canvasapps/Claims/Src/Screen1.fx.yaml
+  Items: =Search(Claims, txtSearch.Text, "Description")
```

## The path forward the verdict must give

A delegable query (StartsWith on an indexed column, or a Dataverse view), tested with synthetic data above the row limit.
