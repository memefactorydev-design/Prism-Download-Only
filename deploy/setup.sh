#!/usr/bin/env bash
# Prism AI server bootstrap — Ubuntu 24.04, idempotent. Run as root.
set -euo pipefail

APP_DIR=/opt/prism/app
REPO_URL=${PRISM_REPO_URL:-https://github.com/memefactorydev-design/Prism-Download-Only.git}

echo "── packages ──"
apt-get update -y
apt-get install -y curl git rsync debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "── prism user ──"
id -u prism &>/dev/null || useradd --system --create-home --shell /bin/bash prism

echo "── clone + build ──"
mkdir -p /opt/prism && chown prism:prism /opt/prism
if [[ ! -d $APP_DIR/.git ]]; then
  sudo -u prism git clone "$REPO_URL" "$APP_DIR"
else
  sudo -u prism git -C "$APP_DIR" pull
fi
cd "$APP_DIR"
sudo -u prism npm ci
sudo -u prism npm run setup   # writes .env (generated secrets), migrates the DB
# A server reachable from the internet must not open without a login. Pass
# PRISM_OPEN_ACCESS=1 to keep the no-login mode (VPN / IP allow-list only).
if [[ "${PRISM_OPEN_ACCESS:-0}" != "1" ]]; then
  sudo -u prism sed -i 's/^OPEN_ACCESS=.*/OPEN_ACCESS="0"/' "$APP_DIR/.env"
fi
sudo -u prism npm run build

echo "── systemd + caddy ──"
cp deploy/prism-web.service deploy/prism-worker.service /etc/systemd/system/
systemctl daemon-reload
[[ -f /etc/caddy/Caddyfile.bak ]] || cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak 2>/dev/null || true
cp deploy/Caddyfile /etc/caddy/Caddyfile
echo
PASSWORD=$(grep -E '^DASHBOARD_PASSWORD=' "$APP_DIR/.env" | cut -d'"' -f2)
ADMIN=$(grep -E '^ADMIN_EMAIL=' "$APP_DIR/.env" | cut -d'"' -f2)
echo "Done. Next:"
echo "  1. Edit /opt/prism/app/.env — set APP_BASE_URL to your public URL and ADMIN_EMAIL to yours."
if [[ "${PRISM_OPEN_ACCESS:-0}" == "1" ]]; then
  echo "     The app opens WITHOUT a login (OPEN_ACCESS=1) — only do this behind a VPN or IP allow-list."
else
  echo "     Login is ON. First sign-in creates the admin: ${ADMIN:-you@example.com} / ${PASSWORD:-<see DASHBOARD_PASSWORD in .env>}"
fi
echo "     AI engine: sign in to Claude Code or Codex as the prism user (sudo -u prism claude auth login / codex login),"
echo "     or add ANTHROPIC_API_KEY. Optional services go in .env or on /connections."
echo "  2. Edit /etc/caddy/Caddyfile — set your domain (or <server-ip>.sslip.io)."
echo "  3. systemctl enable --now prism-web prism-worker caddy"
