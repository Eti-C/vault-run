#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu droplet. Safe to re-run.
#   ssh root@<droplet-ip> 'bash -s' < deploy/setup-droplet.sh
# DNS for $DOMAIN must already point at the droplet (certbot checks it).
set -euo pipefail

DOMAIN=vault-run.onlineplaymoneybank.com
REPO=https://github.com/Eti-C/vault-run.git
APP_DIR=/opt/vault-run

# Small droplets (512 MB) need swap headroom for apt and npm.
if ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq ca-certificates curl git sudo nginx certbot python3-certbot-nginx ufw

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi

id vaultrun >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/vaultrun --shell /usr/sbin/nologin vaultrun
install -d -o vaultrun -g vaultrun "$APP_DIR"

as_app() { sudo -u vaultrun -H "$@"; }
if [ -d "$APP_DIR/.git" ]; then
  as_app git -C "$APP_DIR" pull --ff-only
else
  as_app git clone "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR" && as_app npm ci --omit=dev)

cp "$APP_DIR/deploy/vault-run.service" /etc/systemd/system/vault-run.service
systemctl daemon-reload
systemctl enable --now vault-run
systemctl restart vault-run

# Only install the plain-HTTP site the first time; certbot edits it afterwards.
if [ ! -e /etc/nginx/sites-available/vault-run ]; then
  cp "$APP_DIR/deploy/nginx-vault-run.conf" /etc/nginx/sites-available/vault-run
fi
ln -sf /etc/nginx/sites-available/vault-run /etc/nginx/sites-enabled/vault-run
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
  --register-unsafely-without-email --redirect --keep-until-expiring

echo "Done: https://$DOMAIN"
