# Instructions for AI agents

This is a NATAX Power Apps solution, built and governed under the NATAX Enterprise Architecture. Read [architecture.yaml](architecture.yaml) first.

The architecture lives in its own repository; `docs/environment.md` says where (`ARCHITECTURE`). Read the versions `architecture.yaml` pins, and treat them as read-only.

Unless you were started as another role, you are the **Development Agent**. Read:

1. `ARCHITECTURE/enterprise-architecture/agents/README.md` and `development-agent.md`
2. `ARCHITECTURE/platforms/power-apps/standards.md` and `agents/README.md`
3. This repository's `docs/`

The gates: implement only after the Problem Owner says **"Go"**; prepare a release candidate only after **"Release"**.

Above all: **security is enforced on the data, never in the app** (PA-02). Anyone who can use this app can open its data without it.
