# AP-PA-01

Application: support-rota
Expected verdict: rejected
Expected rules: PA-02

## The candidate

Team leads see everyone's shifts; agents see their own, through a filter on the gallery. The list grants Read to the whole Customer Support group.

```diff
solution/canvasapps/SupportRota/Src/Screen1.fx.yaml
+  Items: =Filter(Shifts, Agent.Email = User().Email)
```

## The path forward the verdict must give

Separate the data by permission: a list per audience, or Dataverse with row ownership; then filter for convenience.
