# Security

Prism AI runs on your own machine or server. Keep it safe:

- **Do not expose an instance with `OPEN_ACCESS="1"` to the public internet.** Set `OPEN_ACCESS="0"` and a strong `DASHBOARD_PASSWORD` first (the VPS script does this by default).
- Service keys you add are encrypted at rest with `TOKEN_ENCRYPTION_KEY` (AES-256-GCM). Back up `.env` with the same care as the database.
- Prism never reads or stores your Claude Code or Codex credentials; it only runs the signed-in CLI.

## Reporting a vulnerability

Please report security issues privately rather than in a public issue: open a GitHub security advisory on this repository (Security → Report a vulnerability), or email the address in the repository profile. Include steps to reproduce. You will get an acknowledgement within a few days.
