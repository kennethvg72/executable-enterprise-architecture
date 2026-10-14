# Power Apps solution: repository layout

Copy this folder to start a new Power Apps solution ([BOOTSTRAP.md](../BOOTSTRAP.md)).

```
architecture.yaml          what it is, who owns it, which architecture governs it
AGENTS.md, CLAUDE.md       instructions for agents
provisioning/              versioned scripts that create the SharePoint lists, columns, permissions and retention (PA-02)
solution/                  the unpacked solution (pac solution init / sync): apps, flows, tables,
                           connection references, environment variables. The system of record.
tests/
  app/                     Playwright tests of the app, per requirement (PA-12)
  permissions/             tests against the data source itself, per role, and of elevated flows (PA-02, PA-07)
  data/                    the synthetic data generator, including data above the delegation limit
docs/
  requirements.md, decisions/, reviews/, runbooks/, environment.md
releases/                  release candidates and verdicts
```

The platform is the runtime. The only `package.json` is for the tests (TypeScript with Playwright, run by Node.js). The `out/` folder (packed solutions, checker results) is not committed.
