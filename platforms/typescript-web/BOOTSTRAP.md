# Bootstrap: a TypeScript web application

For an AI coding agent that has completed the [general bootstrap](../../BOOTSTRAP.md): the Problem Owner described their problem, the [landscape](../../enterprise-architecture/landscape/landscape.md) check is recorded, and a TypeScript web application fits ([platforms](../README.md)). The general ground rules still apply.

**Done when** the template's tests pass against a real database, inside the sandbox, and the application answers its readiness check.

## 1. Linux

Development happens on Linux, because production is Linux ([TS-13](standards.md#ts-13-develop-on-linux-against-the-same-postgresql-major-version-as-production)). On Linux or macOS (with Homebrew), continue with step 2. On Windows, that means WSL 2, and handing over to a session inside it:

1. Check `wsl.exe --status` and `wsl.exe --list --verbose`. Use an existing WSL 2 distribution with Ubuntu 24.04 or later if there is one.
2. If WSL isn't installed: installing it needs administrator rights and a restart. Ask the Problem Owner to run `wsl --install -d Ubuntu-24.04` in a terminal opened with **Run as administrator**, restart, and complete Ubuntu's first start. If it reports that virtualization is disabled, explain that it must be enabled in the computer's firmware settings, and stop there.
3. Make sure systemd is enabled, so PostgreSQL can run as a service: `/etc/wsl.conf` in Ubuntu must contain `[boot]` and `systemd=true`. If you change it, run `wsl.exe --shutdown` and start Ubuntu again.
4. **Move your notes** (the problem in the Problem Owner's words, the landscape check and its outcome, the platform choice, and that this session had no sandbox) to where the next session can read them: `C:\Users\<name>\bootstrap-notes.md`, which Ubuntu sees as `/mnt/c/Users/<name>/bootstrap-notes.md`.
5. **Hand over.** Tell the Problem Owner, step by step: open Ubuntu; install the coding agent there with its own installer and sign in; clone the architecture into the Linux file system (`mkdir -p ~/code && cd ~/code && git clone <architecture repository>`, not under `/mnt/c`, which is slow and breaks file permissions); in VS Code, use **WSL: Connect to WSL** and open `~/code`; start the agent and tell it: *"First read my notes at /mnt/c/Users/<name>/bootstrap-notes.md. Then read the architecture's BOOTSTRAP.md, do steps 2 to 4, and continue with platforms/typescript-web/BOOTSTRAP.md, step 2."* The new session moves the notes into `~/code` and works from there. Then stop: the new session continues.

## 2. Base tools for Linux

`curl` and `ca-certificates`, plus `bubblewrap` and `socat` for the sandbox if the general bootstrap's step 4 didn't install them already:

```sh
sudo apt-get update && sudo apt-get install -y curl ca-certificates bubblewrap socat   # Ubuntu/Debian
```

Node.js 24 must be installed **in Linux** too (the general bootstrap's step 2, which covers distributions whose own Node.js is too old).

**Done when:** `bwrap --version`, `socat -V` and `node -e "const x: number = 1; console.log(x)"` work. The last shows Node.js runs TypeScript directly ([TS-01](standards.md#ts-01-nodejs-lts-and-strict-typescript-without-a-build-step)).

## 3. PostgreSQL 18

Production runs PostgreSQL 18, so development must too.

- **Ubuntu/Debian:** use the PostgreSQL project's own repository (PGDG), then install `postgresql-18`:
  ```sh
  sudo apt-get install -y postgresql-common
  sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  sudo apt-get install -y postgresql-18
  ```
- **macOS:** `brew install postgresql@18 && brew services start postgresql@18`.

Make sure it listens on localhost only (the default). Create a development role that can create databases and the application's runtime role. It is development-only, local-only, and holds synthetic data only:

```sh
sudo -u postgres psql -c "CREATE ROLE app LOGIN CREATEDB CREATEROLE PASSWORD 'app'"     # Linux
psql postgres -c "CREATE ROLE app LOGIN CREATEDB CREATEROLE PASSWORD 'app'"             # macOS
```

The application never runs as this role: it runs as its own least-privileged role, which `npm run db:setup` creates ([SEC-09](../../enterprise-architecture/principles/security.md#sec-09-least-privilege-for-workloads)).

**Done when:** `psql "postgres://app:app@localhost:5432/postgres" -c "select version()"` shows PostgreSQL 18.

## 4. The sandbox, with local network

The application's tests reach PostgreSQL and their own test servers on `localhost`. Allow local network access in the sandbox (Codex: `-c sandbox_workspace_write.network_access=true`; Claude Code: allow `localhost` in the sandbox's network settings). Nothing else needs network access.

## 5. The repository

**Changing an existing application?** Clone its repository instead, then `cp .env.example .env` and `npm ci`, and continue with step 6. The rest of this step is for new applications only.

Copy [template/](template/) to a new folder outside the architecture repository (for example `~/code/<application-name>`), and `git init` there. Replace the placeholder name everywhere: `my-application` and `my_application` (in `package.json`, `architecture.yaml`, `.env.example` and the migrations), `APP_NAME` in `src/app.ts`, the group in `src/roles.ts`. Write the landscape check from your notes into `docs/decisions/0000-landscape-check.md`. Then:

```sh
cp .env.example .env      # development settings; git-ignored
npm ci
```

## 6. Prove that it works

From inside the sandbox:

```sh
npm run db:setup          # creates the databases and the runtime role, migrates development
npm run typecheck
npm test                  # every test must pass; none may be skipped
npm run smoke             # starts the application, waits until it is ready, stops it
node ARCHITECTURE/enterprise-architecture/tools/check-dependencies.ts .   # must pass
node ARCHITECTURE/enterprise-architecture/tools/scan-secrets.ts .         # must pass
node ARCHITECTURE/enterprise-architecture/tools/validate-manifest.ts .
```

For a new application, `validate-manifest` fails on exactly these, and that's expected:

| Failure | Resolved by |
|---|---|
| `MANIFEST`: the template's placeholder description and resilience statement | You and the Problem Owner, in your next conversation |
| `OWN-01`: the Problem Owner `jdoe` isn't in the workforce directory | The Problem Owner's own workforce id |
| `DAT-06`: the database isn't provisioned on `app-db` | Central IT, when the application first goes through the pipeline. Tell the Problem Owner it's coming, not that something is broken. |

## 7. Record and continue

Write `docs/environment.md` (operating system, Node.js and PostgreSQL versions, where `ARCHITECTURE` is, which model tests, how the sandbox was verified, what passed) and commit it. Read the role files listed in the application's `AGENTS.md`, and continue the conversation with the Problem Owner as the Development Agent.
