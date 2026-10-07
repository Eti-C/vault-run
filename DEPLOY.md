# Vault Run — Deployment Guide

| URL | What | Hosted on |
|-----|------|-----------|
| `https://play.onlineplaymoneybank.com` | The game (HTML/CSS/JS) | GitHub Pages, from this repo's `main` branch |
| `https://vault-run.onlineplaymoneybank.com` | Multiplayer server (Socket.io over `wss://`) | DigitalOcean droplet: nginx → Node `server.js` |

`js/config.js` picks the server automatically: pages served from
`*.onlineplaymoneybank.com` or `*.github.io` connect to
`https://vault-run.onlineplaymoneybank.com`; anything else (localhost, a LAN IP)
connects to the server that served the page, as before. An address typed into
the Multiplayer screen overrides both.

The droplet also serves a full copy of the game at its own URL, which is handy
for testing the server on its own.

---

## DNS (Namecheap → Domain List → onlineplaymoneybank.com → Advanced DNS)

| Type | Host | Value |
|------|------|-------|
| A Record | `vault-run` | the droplet's IPv4 address |
| CNAME Record | `play` | `eti-c.github.io.` |

Leave the existing records for the root domain (the other GitHub Pages site) alone.

---

## GitHub Pages (one time, needs admin on the repo)

Repo → **Settings → Pages**:
1. **Source:** Deploy from a branch → `main` / `/ (root)` → Save.
2. **Custom domain:** `play.onlineplaymoneybank.com` (the `CNAME` file in the repo sets this too).
3. Once the certificate is issued (a few minutes after DNS resolves), tick **Enforce HTTPS**.

Every push to `main` redeploys the game. The whole repo is published, so never
commit secrets — there are none today; the server needs no keys.

---

## Droplet (one time)

Ubuntu droplet with your SSH key. After the `vault-run` A record resolves:

```bash
ssh root@<droplet-ip> 'bash -s' < deploy/setup-droplet.sh
```

That script (safe to re-run) installs Node 22, nginx, and certbot; clones this
repo to `/opt/vault-run`; runs it as the unprivileged `vaultrun` user under
systemd (`deploy/vault-run.service`, listening on 127.0.0.1:3000 only); puts
nginx in front (`deploy/nginx-vault-run.conf`, with websocket upgrade headers);
gets a Let's Encrypt certificate with HTTP→HTTPS redirect; and enables the
firewall (SSH + 80/443 only). Certificates auto-renew via certbot's timer.

---

## Updating

- **Game files** (`index.html`, `css/`, `js/`): push to `main`. Pages redeploys in a minute or two.
- **Server** (`server.js`, dependencies): push to `main`, then
  ```bash
  ssh root@<droplet-ip> 'bash -s' < deploy/update.sh
  ```

---

## Verify

1. `https://vault-run.onlineplaymoneybank.com/socket.io/socket.io.js` returns JavaScript.
2. Open `https://play.onlineplaymoneybank.com` → 🌐 Multiplayer → "Connected to server ✅".
3. Host a room, join it from a second browser with the code, start a round.

## Troubleshooting

| Problem | Check |
|---------|-------|
| "Could not reach server" | `ssh root@<ip> journalctl -u vault-run -n 50` |
| 502 Bad Gateway | `systemctl status vault-run` — the Node process is down |
| Websocket drops | `tail -f /var/log/nginx/error.log` |
| Certificate problems | `certbot certificates`, `certbot renew --dry-run` |
| Pages shows old files | Hard-refresh (Cmd/Ctrl+Shift+R); check the repo's Actions tab for the Pages build |

Balances and rooms are kept in memory, so restarting the server resets them.
