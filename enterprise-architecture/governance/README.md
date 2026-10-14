# Governing the architecture

Architecture should govern engineering. Engineering must also challenge and improve the architecture. Without the second half, executable architecture becomes automated enforcement of bad decisions.

| Topic | File |
|---|---|
| Who is accountable for the architecture, and how they work | [architecture-board.md](architecture-board.md) |
| How architecture versions are proposed, activated, deprecated and retired | [lifecycle.md](lifecycle.md) |
| Which versions exist and their status (machine-readable) | [versions.yaml](versions.yaml) |
| What happens when a solution can't comply; findings, risks and exceptions | [escalation.md](escalation.md) |
| Exceptions the Board has granted (machine-readable) | [exceptions.yaml](exceptions.yaml) |
| How the architecture itself is reviewed and simplified | [architecture-review.md](architecture-review.md) |

## The short version

- The **Architecture Board** owns the architecture. It improves it continually, rather than reviewing projects one by one. The pipeline reviews the projects.
- The architecture is **versioned**. Applications pin versions. New versions are tested against the real landscape before they become mandatory.
- When a solution can't comply, the Development Agent **escalates**. The Board's answer is never just "no": every rejected design comes with a compliant path forward.
- **Exceptions are rare and temporary.** A recurring exception means the architecture is wrong, and the fix is a new version, not more exceptions.
