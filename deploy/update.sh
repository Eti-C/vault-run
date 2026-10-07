#!/usr/bin/env bash
# Pull the latest main onto the droplet and restart the server.
#   ssh root@<droplet-ip> 'bash -s' < deploy/update.sh
set -euo pipefail
cd /opt/vault-run
sudo -u vaultrun -H git pull --ff-only
sudo -u vaultrun -H npm ci --omit=dev
systemctl restart vault-run
systemctl --no-pager status vault-run | head -5
