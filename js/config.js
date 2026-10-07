/* ═══════════════════════════════════════════════════════════════
   VAULT RUN — Master Config
   ─────────────────────────────────────────────────────────────
   Edit anything here to change game behaviour without touching
   the game logic files. Numbers, colours, text, prices — all here.
═══════════════════════════════════════════════════════════════ */

const VR = {

  /* ── Canvas / display ── */
  CANVAS_W: 900,
  CANVAS_H: 460,

  /* ── World / map ── */
  WORLD_W:  6000,   // total scrollable width (px)
  GROUND_Y: 370,    // Y position of the street floor

  /* ── Round timer (seconds) ── */
  ROUND_TIME: 180,

  /* ── Cash pickup settings ── */
  CASH: {
    SPAWN_COUNT:    60,    // total pickups seeded at round start
    RESPAWN_DELAY:  8000,  // ms before a collected pickup respawns
    VALUES: {              // zone → cash value range [min, max]
      commercial:  [20,  80],
      backstreets: [10,  40],
      industrial:  [50, 200],
      bankrow:     [5,   25],
    },
  },

  /* ── Bank settings ── */
  BANKS: {
    MAX_HEALTH:    100,
    DECAY_RATE:    2,      // health lost per second
    DEPOSIT_HEAL:  15,     // health restored per deposit
    COUNT:         5,      // banks on the map
  },

  /* ── Roles ── */
  ROLES: {
    banker: {
      label:       '🏦 Banker',
      emoji:       '🏦',
      description: 'Collect cash, deposit at banks. Safe from cops. Earns a percentage cut on every deposit.',
      speed:       200,   // px/sec
      carryLimit:  500,   // $VR max carry
      depositCut:  0.10,  // fraction kept on deposit (10%)
      color:       0x3498db,
    },
    truck: {
      label:       '🚛 Armored Truck',
      emoji:       '🚛',
      description: 'Higher carry limit, slower speed. Flat fee plus percentage per delivery. Prime robbery target.',
      speed:       155,
      carryLimit:  1200,
      depositCut:  0.08,
      flatFee:     50,    // flat $VR added per deposit
      color:       0x95a5a6,
    },
    thief: {
      label:       '🦹 Money Thief',
      emoji:       '🦹',
      description: 'Rob truck workers for 100% of their carry. Fast, but cops fine you on sight.',
      speed:       230,
      carryLimit:  999999,
      depositCut:  1.00,  // thieves keep 100% when they deposit stolen cash
      color:       0xe74c3c,
    },
  },

  /* ── Store items catalogue ── */
  STORE_ITEMS: {
    phone: {
      id:          'phone',
      emoji:       '📱',
      name:        'Smartphone',
      price:       800,
      available:   ['banker','truck','thief'],
      description: 'Enables robbery reporting (banker/truck) and cop tip-offs. Thieves can buy it but get no function.',
    },
    scanner: {
      id:          'scanner',
      emoji:       '🚔',
      name:        'Police Scanner',
      price:       1100,
      available:   ['thief'],
      description: 'Extends the range cop positions appear on the mini-map. Awareness only — does not reduce fines.',
    },
    bag: {
      id:          'bag',
      emoji:       '🎒',
      name:        'Reinforced Bag',
      price:       500,
      available:   ['banker','truck'],
      description: '+40% maximum cash carry capacity. Fewer deposit runs needed.',
    },
    shoes: {
      id:          'shoes',
      emoji:       '👟',
      name:        'Running Shoes',
      price:       350,
      available:   ['banker','truck','thief'],
      description: '+15% movement speed. Helps thieves sprint out of cop proximity faster.',
    },
    vest: {
      id:          'vest',
      emoji:       '🔒',
      name:        'Security Vest',
      price:       950,
      available:   ['banker','truck'],
      description: 'If robbed, thief only takes 60% of your carry balance instead of 100%.',
    },
    disguise: {
      id:          'disguise',
      emoji:       '🕶️',
      name:        'Disguise Kit',
      price:       1200,
      available:   ['thief'],
      description: 'Masks your marker for 30 seconds after a robbery. Single use per session, never lost.',
      sessionReset: true,
    },
    minimap: {
      id:          'minimap',
      emoji:       '🗺️',
      name:        'Mini-map Upgrade',
      price:       400,
      available:   ['banker','truck','thief'],
      description: 'Expands mini-map visibility range. Stacks with police scanner.',
    },
  },

  /* ── Difficulty settings ── */
  DIFFICULTY: {
    easy: {
      label:        'Easy',
      copCount:     1,
      copSpeed:     60,
      earnMult:     0.6,
      cpuSkill:     0.3,   // 0–1 scale used by CPU AI
    },
    medium: {
      label:        'Medium',
      copCount:     2,
      copSpeed:     90,
      earnMult:     0.8,
      cpuSkill:     0.55,
    },
    hard: {
      label:        'Hard',
      copCount:     3,
      copSpeed:     120,
      earnMult:     1.0,
      cpuSkill:     0.75,
    },
    expert: {
      label:        'Expert',
      copCount:     5,
      copSpeed:     150,
      earnMult:     1.4,
      cpuSkill:     0.95,
    },
  },

  /* ── Cop fine schedule ── */
  FINES: {
    // single-player fines (keyed by difficulty)
    easy:   { initial: 0.05, perSec: 0.01 },
    medium: { initial: 0.10, perSec: 0.02 },
    hard:   { initial: 0.20, perSec: 0.04 },
    expert: { initial: 0.30, perSec: 0.06 },
    // multiplayer always uses this
    multiplayer: { initial: 0.40, perSec: 0.08 },
  },

  /* ── Robbery ── */
  ROBBERY: {
    RANGE:           55,    // px — how close thief must get to trigger robbery
    DURATION:        800,   // ms — robbery animation time
    PHONE_FINE_MIN:  0.30,  // fraction of stolen amount fined if victim has phone
    PHONE_FINE_MAX:  0.80,
  },

  /* ── Cops ── */
  COPS: {
    PROXIMITY_RANGE: 70,   // px — fine triggers within this range
    DISGUISE_IGNORE: false, // disguise kit does NOT fool cops (by spec)
    PATROL_SEGMENTS: [     // [leftX, rightX] patrol bounds per cop index
      [0,    700],
      [700,  1600],
      [1600, 2600],
      [2600, 3800],
      [3800, 6000],
    ],
  },

  /* ── Multiplayer reward premium ── */
  MULTIPLAYER: {
    REWARD_MULT_MIN: 1.4,
    REWARD_MULT_MAX: 2.0,
    COP_COUNT:       5,
    MAX_PLAYERS:     8,
    LATE_JOIN_SECS:  120,
  },

  /* ── Zone definitions (world X ranges) ── */
  ZONES: [
    { name: 'bankrow',     x: 0,    w: 900,  label: '🏦 Bank Row'          },
    { name: 'commercial',  x: 900,  w: 1400, label: '🏢 Commercial District'},
    { name: 'backstreets', x: 2300, w: 900,  label: '🌆 Back Streets'       },
    { name: 'industrial',  x: 3200, w: 1400, label: '🏭 Industrial Zone'    },
    { name: 'backstreets', x: 4600, w: 700,  label: '🌆 Back Streets'       },
    { name: 'bankrow',     x: 5300, w: 700,  label: '🏦 Bank Row East'      },
  ],

  /* ── Alleyway positions (world X, used for cop logic) ── */
  ALLEYWAYS: [
    { x: 1200, w: 80 },
    { x: 2100, w: 80 },
    { x: 3100, w: 80 },
    { x: 4400, w: 80 },
    { x: 5000, w: 80 },
  ],

  /* ── Visual colours (Phaser hex) ── */
  COLORS: {
    ground:     0x2c3e50,
    sky:        0x1a1a2e,
    gold:       0xf5c518,
    green:      0x2ecc71,
    red:        0xe74c3c,
    blue:       0x3498db,
    cop:        0x3498db,
    cash:       0xf5c518,
    bankHealth: 0x2ecc71,
    bankDead:   0x555555,
  },

  /* ── Multiplayer server URL ──────────────────────────────────────
     Leave as null to auto-connect to the same origin (works when
     server.js serves both the game files and multiplayer on one port,
     e.g. localhost:3000 during development).

     Set this when the game is hosted on a web server (port 80/443)
     but the multiplayer server runs separately:

       Local dev (default):  null   → connects to window.location.origin
       Separate port:        'http://localhost:3000'
       Production:           'https://yoursite.com:3000'
       Nginx proxy (cleanest): null → proxy /socket.io/ in nginx config
  ── */
  /* Development (localhost): null  → auto-connects to window.location.origin
     Production:              set to the multiplayer server's HTTPS origin     */
  MP_SERVER: null,   // ← change to 'https://eti.codes' before deploying

  /* ── Starting $VR balances for new players ── */
  STARTING_BALANCE: 0,

  /* ── CPU opponent count in single-player ── */
  CPU_COUNT: 3,

};

/* Freeze so accidental mutations throw loudly during dev */
Object.freeze(VR);
