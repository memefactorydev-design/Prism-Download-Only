# Hosting Prism AI on a VPS

One Linux box runs both processes (web + worker) against the same disk —
SQLite, `uploads/` and `data/` (the agents' file-based memory) all live
together by design. Any Ubuntu 24.04 VPS with 2+ vCPU / 4 GB RAM works; video
rendering is CPU-bound, so more cores = faster Studio renders.

## One-time server setup

```bash
# as root on a fresh Ubuntu 24.04 server — clone first, then run the script:
git clone https://github.com/memefactorydev-design/Prism-Download-Only.git /tmp/prism
bash /tmp/prism/deploy/setup.sh
```

The script installs Node 22, Caddy and build tools, creates the `prism` user,
clones the app to `/opt/prism/app`, runs `npm run setup` (generates `.env` with
fresh secrets and, for a public server, `OPEN_ACCESS=0`; applies the DB migrations), builds, and
installs the two systemd services plus a Caddyfile.

## Configure

1. `/opt/prism/app/.env`
   - `APP_BASE_URL` — your public URL (used in links the app sends out).
   - API keys for the AI features — here, or later on the app's **/connections** page.
   - `OPEN_ACCESS` — the script sets `0` (login on). `1` = no login screen; only behind a VPN / IP allow-list (run the script with `PRISM_OPEN_ACCESS=1` to keep it).
   - AI engine — sign in as the `prism` user (`sudo -u prism claude auth login` or `sudo -u prism codex login`), or set `ANTHROPIC_API_KEY`.
     Set `0` plus a `DASHBOARD_PASSWORD` before exposing the server publicly.
   - `RENDER_CONCURRENCY` — leave a core or two free for the web process.
2. `/etc/caddy/Caddyfile` — set the domain (a real subdomain, or
   `<server-ip>.sslip.io` for instant HTTPS without DNS setup).

## Run

```bash
systemctl enable --now prism-web prism-worker caddy
```

## Update

```bash
bash /opt/prism/app/deploy/deploy.sh     # git pull, npm ci, migrate, build, restart
```

## Backups

`deploy/backup.sh` snapshots the SQLite DB, `uploads/`, `data/` and `.env` —
those four things are the whole state of an instance. Put it on a cron.
