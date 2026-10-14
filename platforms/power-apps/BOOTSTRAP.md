# Bootstrap: a Power Apps solution

For an AI coding agent that has completed the [general bootstrap](../../BOOTSTRAP.md), where the Problem Owner described their problem, the [landscape](../../enterprise-architecture/landscape/landscape.md) check is recorded, and Power Apps fits ([platforms](../README.md)). The general ground rules still apply.

**Done when** a new solution, created from the template, builds as a managed solution, the solution checker runs on it, and it imports into the team's developer environment.

For a **change to an existing app**, clone its repository, follow its `AGENTS.md`, and do steps 1, 2 and 5 only.

1. **The Power Platform CLI.** Check `pac help`. If it's missing, install it: on Windows, macOS or Linux, as a .NET tool (`dotnet tool install --global Microsoft.PowerApps.CLI.Tool`, which needs the .NET SDK) or with the Power Platform Tools extension for VS Code. Ask before installing the .NET SDK. Record the CLI's version: the pipeline uses the same one.
2. **A developer environment.** Ask the Problem Owner whether their team has one. If not, they request one from Central IT: never use the Default environment ([PA-05](standards.md#pa-05-environments-and-the-pipeline-as-the-only-way-into-production)). The Problem Owner signs in themselves (`pac auth create --environment <url>`). You never handle their credentials. Check with `pac env who`.
3. **Licensing and data store** (new apps only). With the Problem Owner, decide SharePoint list or Dataverse, by who may see what, and check what the choice needs in licenses ([PA-03](standards.md#pa-03-choose-the-data-store-by-who-may-see-what)). Record it as a decision.
4. **The repository** (new apps only). Copy [template/](template/) to a new repository, `git init`, and replace the placeholder names. Write the landscape check from your notes into `docs/decisions/0000-landscape-check.md`. Create the solution in its own folder:
   ```sh
   pac solution init --publisher-name natax --publisher-prefix ntx --outputDirectory solution
   ```
   For a SharePoint-based app, write the provisioning script for the list, its columns and its permissions in `provisioning/` ([PA-02](standards.md#pa-02-security-is-enforced-at-the-data-source-never-in-the-app)). Set up the Playwright tests in `tests/` (`npm init` there, with `@playwright/test`).
5. **Prove it works.**
   ```sh
   pac solution pack --zipfile out/solution.zip --folder solution --packagetype Managed
   pac solution check --path out/solution.zip --outputDirectory out/checker
   pac solution pack --zipfile out/solution-dev.zip --folder solution --packagetype Unmanaged
   pac solution import --path out/solution-dev.zip
   ```
   The managed build and the checker show the pipeline's path works; the unmanaged import is for the developer environment only. Confirm the solution appears there. Then write `docs/environment.md` (the CLI version, the developer environment's URL, not its credentials, and what passed), and continue as the Development Agent.
