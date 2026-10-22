#!/usr/bin/env bash
# Pull + rebuild + restart. Run on the server (as root or prism with sudo).
set -euo pipefail
cd /opt/prism/app
sudo -u prism git pull
sudo -u prism npm ci
sudo -u prism npx prisma migrate deploy
sudo -u prism npm run build
systemctl restart prism-web prism-worker
systemctl --no-pager status prism-web prism-worker | grep -E "●|Active"
