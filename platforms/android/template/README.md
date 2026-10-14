# Android app: repository layout

Copy this folder to start a new Android app ([BOOTSTRAP.md](../BOOTSTRAP.md)), then create the Gradle project in it.

```
architecture.yaml               what it is, who owns it, which architecture governs it
AGENTS.md, CLAUDE.md            instructions for agents
settings.gradle.kts, gradlew    the Gradle wrapper and project
gradle/
  libs.versions.toml            the version catalog: approved dependencies only (AND-02)
  verification-metadata.xml     checksums of every dependency, checked on every build (AND-07)
app/
  src/main/AndroidManifest.xml  permissions (each with a decision record, AND-09), backup rules
  src/main/res/xml/
    network_security_config.xml   no cleartext (AND-05)
    data_extraction_rules.xml      tokens and cached data excluded from backups (AND-03)
  src/main/java/...             Kotlin: ui/, data/ (the offline queue, AND-06), api/, auth/
  src/test/                     unit tests
  src/androidTest/              UI tests, run on managed emulators (AND-08)
docs/
  requirements.md, decisions/, reviews/, environment.md
releases/                       release candidates and verdicts
```

No signing configuration and no keystore: only the pipeline signs (AND-07).
