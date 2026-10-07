# Vault Run — Design & Edit Guide

A side-scrolling play-money web game. Collect cash, deposit at banks, dodge NPC cops, earn **$VR** (Vault Run dollars) to spend in the store.

---

## How to open the game

Double-click `index.html` — or serve the folder with any local web server (e.g. VS Code's Live Server extension). No build step needed.

---

## File map

```
index.html              ← Entry point. Loads everything.
css/
  style.css             ← All visual styling. Edit colours here.
js/
  config.js             ← ★ MASTER CONFIG — change game numbers here
  utils.js              ← Helper functions (formatting, toasts, HUD)
  store.js              ← $VR balance + item inventory (localStorage)
  main.js               ← Phaser engine bootstrap
  scenes/
    BootScene.js        ← Asset preloader
    MenuScene.js        ← Main menu
    LoadoutScene.js     ← Role & difficulty picker
    GameScene.js        ← ★ MAIN GAME LOOP — movement, cops, economy
    HUDScene.js         ← Reserved for future Phaser HUD layers
    ResultScene.js      ← Post-round summary
    ResultScene.js      ← Also contains StoreScene (same file)
  entities/
    Player.js           ← Human player: movement, carry bar
    Cop.js              ← NPC cop: patrol, direction flip
    CashPickup.js       ← Coin: collect + respawn
    Bank.js             ← Bank: health decay, deposit, closure
    CPU.js              ← AI opponent: banker/truck/thief behaviour
DESIGN.md               ← This file
```

---

## The fastest edits — all in `js/config.js`

Everything tunable lives in the `VR` object at the top of `config.js`. No need to touch game logic.

### Change round length
```js
ROUND_TIME: 180,   // seconds — change to 120 for shorter rounds
```

### Change how much cash spawns
```js
CASH: {
  SPAWN_COUNT: 60,       // pickups on the map at start
  RESPAWN_DELAY: 8000,   // ms before a coin reappears after being collected
  VALUES: {
    commercial:  [20,  80],   // [min, max] $VR per coin by zone
    industrial:  [50, 200],   // industrial = high risk/reward
  },
},
```

### Change role speeds / carry limits
```js
ROLES: {
  banker: { speed: 200, carryLimit: 500, depositCut: 0.10 },
  truck:  { speed: 155, carryLimit: 1200, depositCut: 0.08, flatFee: 50 },
  thief:  { speed: 230 },
},
```
`depositCut` is the fraction the worker keeps from each deposit (0.10 = 10%).

### Change store item prices
```js
STORE_ITEMS: {
  phone:   { price: 800 },
  scanner: { price: 1100 },
  shoes:   { price: 350 },
  // etc.
},
```

### Change cop behaviour
```js
DIFFICULTY: {
  easy:   { copCount: 1, copSpeed: 60,  earnMult: 0.6 },
  medium: { copCount: 2, copSpeed: 90,  earnMult: 0.8 },
  hard:   { copCount: 3, copSpeed: 120, earnMult: 1.0 },
  expert: { copCount: 5, copSpeed: 150, earnMult: 1.4 },
},
FINES: {
  easy:   { initial: 0.05, perSec: 0.01 },  // 5% balance on contact, 1%/sec stacking
  medium: { initial: 0.10, perSec: 0.02 },
  // ...
},
```

### Change bank decay speed
```js
BANKS: {
  DECAY_RATE:   2,   // health lost per second (lower = banks stay open longer)
  DEPOSIT_HEAL: 15,  // health restored per deposit
},
```

### Change robbery range
```js
ROBBERY: {
  RANGE:    55,   // px — how close a thief must get
  DURATION: 800,  // ms — robbery animation pause
},
```

---

## Restyling the UI

All colours are CSS variables at the top of `css/style.css`:

```css
:root {
  --gold:      #f5c518;   /* main accent */
  --green:     #2ecc71;   /* money/positive */
  --red:       #e74c3c;   /* danger/negative */
  --dark:      #1a1a2e;   /* background */
  --panel-bg:  rgba(0,0,0,0.72);
  --text:      #f0e6c8;
}
```

Change these to instantly retheme the whole UI without touching any JS.

---

## Adding a new store item

1. Add an entry to `VR.STORE_ITEMS` in `config.js`:
```js
shield: {
  id:          'shield',
  emoji:       '🛡️',
  name:        'Gold Shield',
  price:       1500,
  available:   ['banker','truck'],
  description: 'Halves cop fines in the industrial zone.',
},
```

2. Add the effect logic where it applies. For a fine reduction, edit `_checkCopProximity` in `GameScene.js`:
```js
let fine = this.fineConf.initial;
if (Store.owns('shield') && Utils.zoneAt(this.player.sprite.x) === 'industrial') fine *= 0.5;
```

That's it — the store UI renders all items from `VR.STORE_ITEMS` automatically.

---

## Adding a new zone

In `config.js`, add to the `ZONES` array:
```js
{ name: 'casino', x: 2900, w: 300, label: '🎰 Casino Strip' },
```

Then add a cash value range for it:
```js
CASH: {
  VALUES: {
    casino: [100, 500],  // high roller zone
  },
},
```

The world renderer, mini-map, and zone detection all read from `ZONES` automatically.

---

## Deploying to a real website

### Option A — Nginx proxy (recommended, zero code changes)

Run `node server.js` on your server, then add this to your nginx config.
The game files live at `/game` on port 80; nginx forwards socket traffic to port 3000 behind the scenes.

```nginx
# Serve game files at yoursite.com/game
location /game {
    alias /var/www/vault_run;
    index index.html;
}

# Forward Socket.io to the multiplayer server on port 3000
location /socket.io/ {
    proxy_pass         http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
}
```

`VR.MP_SERVER` stays `null` — `window.location.origin` works automatically.

### Option B — Separate port, one config change

If you can't use nginx, set `MP_SERVER` in `js/config.js` to your server's address and port:

```js
MP_SERVER: 'https://yoursite.com:3000',
```

Make sure port 3000 is open in your firewall/security group.
For local dev, leave it as `null` (auto-connects to `localhost:3000`).

### Running the multiplayer server in the background

```bash
npm install
node server.js          # foreground (good for testing)
# or keep it running after logout:
npx pm2 start server.js --name vault-run
```

---

## Connecting to a real website backend

The store currently uses `localStorage`. To connect your sister's website:

1. Open `js/store.js`
2. Find the `/* INTEGRATION NOTE */` comment block
3. Replace `load()` and `save()` with your API calls

The API contract the store expects:
- `GET /api/player` → `{ balance: 1234, inventory: ['phone','shoes'] }`
- `POST /api/player` with body `{ balance, inventory, sessions, totalEarned }`

The game reads item inventory at session start and writes earnings at round end — that's the only coupling between the game and the website store.

---

## Keyboard controls (in-game)

| Key | Action |
|-----|--------|
| ← / A | Move left |
| → / D | Move right |
| R | Report robbery (needs 📱 phone, non-thief only) |
| T | Send cop tip-off (needs 📱 phone, non-thief only) |

Mobile: on-screen ◀ ▶ buttons appear automatically.

---

## Roles quick reference

| Role | Speed | Carry | Earn | Cop target? |
|------|-------|-------|------|------------|
| 🏦 Banker | 200 | $500 | 10% of each deposit | No |
| 🚛 Truck | 155 | $1,200 | 8% + $50 flat fee | No |
| 🦹 Thief | 230 | Unlimited | 100% of robbed carry | **Yes** |

---

## Store items quick reference

| Item | Price | Who can use |
|------|-------|------------|
| 📱 Smartphone | $800 VR | All — reporting + tip-offs for workers |
| 🚔 Police Scanner | $1,100 VR | Thief — extended cop radar |
| 🎒 Reinforced Bag | $500 VR | Banker / Truck — +40% carry |
| 👟 Running Shoes | $350 VR | All — +15% speed |
| 🔒 Security Vest | $950 VR | Banker / Truck — robber takes 60% instead of 100% |
| 🕶️ Disguise Kit | $1,200 VR | Thief — 30s marker mask after robbery |
| 🗺️ Mini-map Upgrade | $400 VR | All — wider minimap view |

---

*All currency is $VR play money. No real money involved.*
