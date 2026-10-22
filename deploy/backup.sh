#!/usr/bin/env bash
# Nightly state backup (run via cron on the server): db + env + uploads + data.
set -euo pipefail
STAMP=$(date +%Y%m%d)
DEST=/opt/prism/backups/$STAMP
mkdir -p "$DEST"
cp /opt/prism/app/dev.db "$DEST/"
cp /opt/prism/app/.env "$DEST/"
rsync -a /opt/prism/app/uploads/ "$DEST/uploads/"
rsync -a /opt/prism/app/data/ "$DEST/data/"
# keep 14 days
find /opt/prism/backups -maxdepth 1 -mtime +14 -exec rm -rf {} +
