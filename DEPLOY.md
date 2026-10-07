# Vault Run — Deployment Guide

Two domains, two VPS servers:

| Domain | Purpose | What runs |
|--------|---------|-----------|
| `onlineplaymoneybank.com` | Game files | nginx static file server |
| `eti.codes` | Multiplayer | nginx + Node.js `server.js` |

---

## Before you deploy — one code change

In `js/config.js`, change:
```js
MP_SERVER: null,
```
to:
```js
MP_SERVER: 'https://eti.codes',
```

That's the only change needed. Save the file, then upload everything.

---

## Server setup (both VPSes — Ubuntu/Debian)

Run these commands after SSH-ing into each server:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash -
sudo apt install -y nodejs

# Install nginx
sudo apt install -y nginx

# Install certbot (for free HTTPS)
sudo apt install -y certbot python3-certbot-nginx

# Install pm2 (keeps Node running after logout)
sudo npm install -g pm2
```

---

## onlineplaymoneybank.com — game files

### 1. Upload files

Copy the whole project folder to the server (use FileZilla, SCP, or rsync):
```bash
rsync -avz ./ user@onlineplaymoneybank.com:/var/www/vault_run/
```

### 2. nginx config

Create `/etc/nginx/sites-available/onlineplaymoneybank.com`:
```nginx
server {
    listen 80;
    server_name onlineplaymoneybank.com www.onlineplaymoneybank.com;

    # Serve the game at /game
    location /game {
        alias /var/www/vault_run;
        index index.html;
        try_files $uri $uri/ /game/index.html;
    }

    # Redirect root to /game
    location / {
        return 301 /game;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/onlineplaymoneybank.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 3. Get HTTPS certificate
```bash
sudo certbot --nginx -d onlineplaymoneybank.com -d www.onlineplaymoneybank.com
```

---

## eti.codes — multiplayer server

### 1. Upload files (only the server-side files are needed)

```bash
rsync -avz ./ user@eti.codes:/var/www/vault_run/
cd /var/www/vault_run
npm install
```

### 2. Start the multiplayer server with pm2

```bash
pm2 start server.js --name vault-run
pm2 save          # survive reboots
pm2 startup       # auto-start on boot (follow the printed command)
```

Check it's running:
```bash
pm2 logs vault-run
```

### 3. nginx config on eti.codes

Create `/etc/nginx/sites-available/eti.codes`:
```nginx
server {
    listen 80;
    server_name eti.codes www.eti.codes;

    # Proxy Socket.io WebSocket traffic to Node on port 3000
    location /socket.io/ {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/eti.codes /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 4. Get HTTPS certificate
```bash
sudo certbot --nginx -d eti.codes -d www.eti.codes
```

Certbot automatically updates the nginx config to redirect HTTP→HTTPS and enables `wss://` (secure WebSocket) — no extra steps needed.

### 5. Allow port 3000 in firewall (internal only — nginx proxies it)
```bash
# Block port 3000 from the internet (nginx handles it on 443)
sudo ufw allow 'Nginx Full'
sudo ufw deny 3000
sudo ufw enable
```

---

## Verify it works

1. Open `https://onlineplaymoneybank.com/game` — game loads
2. Click 🌐 Multiplayer — should say "Connected to server ✅"
3. Click Host Room — room code appears
4. Open a second browser tab, join with the code — both players visible in lobby
5. Start a round — both players appear in the game world

---

## Updates — how to redeploy

After changing game files:
```bash
# On onlineplaymoneybank.com
rsync -avz ./ user@onlineplaymoneybank.com:/var/www/vault_run/

# On eti.codes (only needed if server.js changed)
rsync -avz ./ user@eti.codes:/var/www/vault_run/
pm2 restart vault-run
```

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| "Connected to server" doesn't appear | `pm2 logs vault-run` on eti.codes |
| HTTPS cert expired | `sudo certbot renew` (auto-renews by cron) |
| Game files not updating | Hard-refresh browser (Ctrl+Shift+R) |
| Multiplayer drops connection | Check nginx error log: `sudo tail -f /var/log/nginx/error.log` |
