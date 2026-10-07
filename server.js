/* ════════════════════════════════════════════════════════════════
   VAULT RUN — Multiplayer Server
   ─────────────────────────────────────────────────────────────
   Start:   node server.js        (then open http://localhost:3000)
   Requires: npm install          (installs express + socket.io)

   The server is OPTIONAL. The game runs as single-player without it.

   Architecture
   ────────────
   • Rooms hold up to 8 players. Each room has its own game state.
   • Server is authoritative for: cop positions, bank health,
     fine events, robbery events, and balance commits at round end.
   • Clients are authoritative for their own movement (client-side
     prediction). The server trusts position updates but can add
     lag compensation later.
   • Balances are stored in-memory here (replace with a DB call
     when you connect a real backend — see PERSISTENCE NOTE).
════════════════════════════════════════════════════════════════ */

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');
const crypto    = require('crypto');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },  // tighten this in production
});

/* ── Serve the game files statically ── */
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* ══════════════════════════════════════════════════════════════
   CONFIG (mirrors js/config.js values used server-side)
═══════════════════════════════════════════════════════════════ */
const CFG = {
  ROUND_TIME:     Number(process.env.VR_ROUND_TIME) || 180,
  MAX_PLAYERS:    8,
  LATE_JOIN_SECS: 120,
  COP_COUNT:      5,
  COP_SPEED:      130,
  WORLD_W:        6000,
  GROUND_Y:       370,
  PATROL_SEGMENTS: [
    [0,    700],
    [700,  1600],
    [1600, 2600],
    [2600, 3800],
    [3800, 6000],
  ],
  BANK_POSITIONS:  [200, 900, 1800, 3500, 5400],
  BANK_MAX_HEALTH: 100,
  BANK_DECAY_RATE: 2,     // per second
  DEPOSIT_HEAL:    15,
  FINES: {
    initial: 0.40,
    perSec:  0.08,
  },
  ROBBERY_RANGE:        55,
  PHONE_FINE_MIN:       0.30,
  PHONE_FINE_MAX:       0.80,
  REWARD_MULT_MIN:      1.4,
  REWARD_MULT_MAX:      2.0,
};

/* ══════════════════════════════════════════════════════════════
   PERSISTENCE NOTE
   ───────────────────────────────────────────────────────────
   Balances are kept in memory and pushed to clients. To persist
   across server restarts, replace loadBalance / saveBalance with
   database calls:

     async function loadBalance(playerId) {
       const row = await db.query('SELECT balance FROM players WHERE id=$1', [playerId]);
       return row?.balance ?? 0;
     }

     async function saveBalance(playerId, amount) {
       await db.query('INSERT INTO players(id,balance) VALUES($1,$2)
                       ON CONFLICT(id) DO UPDATE SET balance=balance+$2',
                       [playerId, amount]);
     }
═══════════════════════════════════════════════════════════════ */
const playerBalances = new Map();   // playerId → $VR balance
const playerInventory = new Map();  // playerId → string[]

function loadBalance(id)        { return playerBalances.get(id) ?? 0; }
function saveBalance(id, delta) { playerBalances.set(id, Math.max(0, (playerBalances.get(id) ?? 0) + delta)); }

/* ══════════════════════════════════════════════════════════════
   ROOMS
═══════════════════════════════════════════════════════════════ */
const rooms = new Map();   // code → Room

function makeCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function createRoom(hostId) {
  const code = makeCode();
  const room = {
    code,
    hostId,
    phase:    'lobby',    // lobby | running | ended
    players:  new Map(),  // socketId → PlayerState
    cops:     [],
    banks:    [],
    roundTime: CFG.ROUND_TIME,
    startedAt: null,
    tickInterval: null,
  };
  rooms.set(code, room);
  return room;
}

function roomOf(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) return room;
  }
  return null;
}

/* ── Initial cop state ── */
function makeCops(n) {
  const cops = [];
  for (let i = 0; i < n; i++) {
    const seg = CFG.PATROL_SEGMENTS[i % CFG.PATROL_SEGMENTS.length];
    cops.push({ id: i, x: (seg[0]+seg[1])/2, dir: 1, seg });
  }
  return cops;
}

/* ── Initial bank state ── */
function makeBanks() {
  return CFG.BANK_POSITIONS.map((x, i) => ({ id: i, x, health: CFG.BANK_MAX_HEALTH, open: true }));
}

/* ══════════════════════════════════════════════════════════════
   GAME TICK  (runs server-side at 20 Hz when a round is active)
═══════════════════════════════════════════════════════════════ */
const TICK_MS = 50;  // 20 ticks/sec

function startRound(room) {
  room.phase     = 'running';
  room.cops      = makeCops(CFG.COP_COUNT);
  room.banks     = makeBanks();
  room.roundTime = CFG.ROUND_TIME;
  room.startedAt = Date.now();

  /* Track per-player session earnings separately from persistent balance */
  room.players.forEach(p => { p.sessionEarnings = 0; p.carry = 0; p.nearCop = false; });

  io.to(room.code).emit('round:start', {
    cops:  room.cops,
    banks: room.banks,
    roundTime: room.roundTime,
  });

  /* Tick interval */
  let elapsed = 0;
  room.tickInterval = setInterval(() => {
    const dt = TICK_MS / 1000;
    elapsed += dt;

    /* Move cops */
    room.cops.forEach(cop => {
      cop.x += CFG.COP_SPEED * cop.dir * dt;
      if (cop.x >= cop.seg[1]) { cop.x = cop.seg[1]; cop.dir = -1; }
      if (cop.x <= cop.seg[0]) { cop.x = cop.seg[0]; cop.dir =  1; }
    });

    /* Bank decay */
    room.banks.forEach(bank => {
      if (!bank.open) return;
      bank.health -= CFG.BANK_DECAY_RATE * dt;
      if (bank.health <= 0) {
        bank.health = 0;
        bank.open   = false;
        io.to(room.code).emit('bank:closed', { bankId: bank.id });
      }
    });

    /* Cop proximity fines for thief players */
    room.players.forEach((p, sid) => {
      if (p.role !== 'thief') return;
      let hitCop = false;
      room.cops.forEach(cop => {
        const dist = Math.abs(p.x - cop.x);
        if (dist < 70) hitCop = true;
      });

      if (hitCop) {
        const balance = loadBalance(p.id) + p.sessionEarnings;
        if (!p.nearCop) {
          const fine = Math.max(10, balance * CFG.FINES.initial);
          p.sessionEarnings -= fine;
          p.nearCop = true;
          io.to(sid).emit('fine:cop', { amount: fine, type: 'initial' });
        } else {
          p.copFineAcc = (p.copFineAcc || 0) + dt;
          if (p.copFineAcc >= 1) {
            p.copFineAcc = 0;
            const fine = Math.max(2, balance * CFG.FINES.perSec);
            p.sessionEarnings -= fine;
            io.to(sid).emit('fine:cop', { amount: fine, type: 'stack' });
          }
        }
      } else {
        p.nearCop    = false;
        p.copFineAcc = 0;
      }
    });

    /* Broadcast cop positions every tick */
    io.to(room.code).emit('cops:update', room.cops);

    /* Broadcast bank health every 2s */
    if (Math.round(elapsed * 20) % 40 === 0) {
      io.to(room.code).emit('banks:update', room.banks);
    }

    /* Round timer */
    room.roundTime -= dt;
    if (room.roundTime <= 0) endRound(room);

  }, TICK_MS);
}

function endRound(room) {
  if (room.phase === 'ended') return;
  room.phase = 'ended';
  clearInterval(room.tickInterval);

  /* Calculate multiplayer reward premium based on player count */
  const count = room.players.size;
  const mult  = Math.min(CFG.REWARD_MULT_MAX,
    CFG.REWARD_MULT_MIN + (count / CFG.MAX_PLAYERS) * (CFG.REWARD_MULT_MAX - CFG.REWARD_MULT_MIN));

  const allOpen = room.banks.every(b => b.open);

  /* Commit earnings for each player */
  const results = [];
  room.players.forEach((p, sid) => {
    let net = Math.max(0, Math.floor(p.sessionEarnings * mult));
    if (allOpen && p.role !== 'thief') net = Math.floor(net * 1.25);
    saveBalance(p.id, net);
    results.push({ socketId: sid, playerId: p.id, earned: net, newBalance: loadBalance(p.id) });
    io.to(sid).emit('round:end', {
      earned:     net,
      newBalance: loadBalance(p.id),
      allOpen,
      mult,
    });
  });

  console.log(`[Room ${room.code}] Round ended. Results:`, results.map(r => `${r.playerId}:+${r.earned}`).join(', '));

  /* Clean up room after 30s */
  setTimeout(() => rooms.delete(room.code), 30000).unref();
}

/* ══════════════════════════════════════════════════════════════
   SOCKET EVENTS
═══════════════════════════════════════════════════════════════ */
io.on('connection', socket => {
  const from = (socket.handshake.address || '').replace(/^::ffff:/, '');
  console.log(`[connect] ${socket.id} from ${from} (page: ${socket.handshake.headers.origin || 'none'})`);

  /* ── Create room ── */
  socket.on('room:create', ({ playerId, role, items, balance }, ack) => {
    if (Number.isFinite(balance)) playerBalances.set(playerId, Math.max(0, balance));
    leaveRoom(socket);
    const room = createRoom(socket.id);
    const p = { id: playerId, role, items: items || [], x: CFG.WORLD_W/2, y: CFG.GROUND_Y, carry: 0, sessionEarnings: 0, nearCop: false };
    room.players.set(socket.id, p);
    socket.join(room.code);

    console.log(`[room:create] ${room.code} by ${playerId}`);
    ack({ ok: true, code: room.code, balance: loadBalance(playerId) });

    io.to(room.code).emit('lobby:update', _lobbyState(room));
  });

  /* ── Join room ── */
  socket.on('room:join', ({ code, playerId, role, items, balance }, ack) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const refuse = reason => {
      console.log(`[room:join] ${from} refused for "${code}": ${reason}`);
      ack({ ok: false, reason });
    };
    if (!room) return refuse('Room not found');
    if (room.phase === 'ended') return refuse('Round already ended');
    if (room.players.size >= CFG.MAX_PLAYERS) return refuse('Room full');

    /* Late-join check */
    if (room.phase === 'running') {
      const sinceStart = (Date.now() - room.startedAt) / 1000;
      if (sinceStart > CFG.LATE_JOIN_SECS) return refuse('Late-join window closed');
    }

    if (Number.isFinite(balance)) playerBalances.set(playerId, Math.max(0, balance));
    if (roomOf(socket.id) !== room) leaveRoom(socket);
    const p = { id: playerId, role, items: items || [], x: CFG.WORLD_W/2, y: CFG.GROUND_Y, carry: 0, sessionEarnings: 0, nearCop: false };
    room.players.set(socket.id, p);
    socket.join(room.code);

    console.log(`[room:join] ${room.code} by ${playerId} from ${from}`);
    ack({ ok: true, code: room.code, balance: loadBalance(playerId), phase: room.phase });

    socket.to(room.code).emit('player:joined', { socketId: socket.id, ...p });
    io.to(room.code).emit('lobby:update', _lobbyState(room));
  });

  /* ── Player picks a role in the lobby ── */
  socket.on('player:role', ({ role } = {}) => {
    const room = roomOf(socket.id);
    if (!room || room.phase !== 'lobby' || !['banker', 'truck', 'thief'].includes(role)) return;
    room.players.get(socket.id).role = role;
    io.to(room.code).emit('lobby:update', _lobbyState(room));
  });

  /* ── Host starts round ── */
  socket.on('round:start', () => {
    const room = roomOf(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    startRound(room);
  });

  /* ── Player position update (client → server → others) ── */
  socket.on('player:move', ({ x, y, carry }) => {
    const room = roomOf(socket.id);
    if (!room || room.phase !== 'running') return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.x = x; p.y = y; p.carry = carry;
    socket.to(room.code).emit('player:moved', { socketId: socket.id, x, y, carry });
  });

  /* ── Thief initiates robbery against a victim socket ── */
  socket.on('robbery:attempt', ({ victimSocketId }) => {
    const room = roomOf(socket.id);
    if (!room || room.phase !== 'running') return;
    const thief  = room.players.get(socket.id);
    const victim = room.players.get(victimSocketId);
    if (!thief || !victim) return;

    const dist = Math.abs(thief.x - victim.x);
    if (dist > 100) return;  // sanity check

    let take = victim.items.includes('vest') ? victim.carry * 0.6 : victim.carry;
    victim.carry = 0;
    thief.carry += take;
    thief.sessionEarnings += take;

    io.to(socket.id).emit('robbery:success', { take, victimId: victim.id });
    io.to(victimSocketId).emit('robbery:victim', { thiefId: thief.id, lost: take });

    /* Victim reports if they have a phone */
    if (victim.items.includes('phone')) {
      const fracMin = CFG.PHONE_FINE_MIN, fracMax = CFG.PHONE_FINE_MAX;
      const frac = fracMin + Math.random() * (fracMax - fracMin);
      const fine = take * frac;
      thief.sessionEarnings -= fine;
      io.to(socket.id).emit('fine:reported', { amount: fine });
      io.to(victimSocketId).emit('report:confirmed', { fine });
    }
  });

  /* ── Worker deposits at a bank ── */
  socket.on('deposit', ({ bankId, amount }) => {
    const room = roomOf(socket.id);
    if (!room || room.phase !== 'running') return;
    const p    = room.players.get(socket.id);
    const bank = room.banks[bankId];
    if (!p || !bank || !bank.open) return;

    /* Earn cut */
    const roleEarnings = {
      banker: amount * 0.10,
      truck:  amount * 0.08 + 50,
    };
    const cut = (roleEarnings[p.role] || 0) * 2.0;  // multiplayer premium ×2
    p.sessionEarnings += cut;
    p.carry = 0;

    bank.health = Math.min(CFG.BANK_MAX_HEALTH, bank.health + CFG.DEPOSIT_HEAL);
    io.to(room.code).emit('banks:update', room.banks);
    socket.emit('deposit:confirmed', { cut, newCarry: 0 });
  });

  /* ── Player reports robbery manually (R key) ── */
  socket.on('robbery:report', ({ thiefSocketId }) => {
    const room = roomOf(socket.id);
    if (!room || room.phase !== 'running') return;
    const reporter = room.players.get(socket.id);
    const thief    = room.players.get(thiefSocketId);
    if (!reporter || !thief || !reporter.items.includes('phone')) return;

    const fine = thief.carry * (CFG.PHONE_FINE_MIN + Math.random() * (CFG.PHONE_FINE_MAX - CFG.PHONE_FINE_MIN));
    thief.sessionEarnings -= fine;
    io.to(thiefSocketId).emit('fine:reported', { amount: fine });
    socket.emit('report:confirmed', { fine });
  });

  /* ── Cop tip-off (T key) ── */
  socket.on('tipoff:request', () => {
    const room = roomOf(socket.id);
    if (!room || room.phase !== 'running') return;
    const p = room.players.get(socket.id);
    if (!p || p.role === 'thief' || !p.items.includes('phone')) return;
    /* Broadcast cop positions to all legitimate workers */
    room.players.forEach((other, sid) => {
      if (other.role !== 'thief') {
        io.to(sid).emit('tipoff:received', { cops: room.cops, fromId: p.id });
      }
    });
  });

  socket.on('disconnect', reason => {
    console.log(`[disconnect] ${socket.id} from ${from}: ${reason}`);
    leaveRoom(socket);
  });
});

/* ── Remove a socket from whatever room it is in ── */
function leaveRoom(socket) {
  const room = roomOf(socket.id);
  if (!room) return;
  console.log(`[leave] ${socket.id} left room ${room.code}`);
  room.players.delete(socket.id);
  socket.leave(room.code);
  if (room.hostId === socket.id && room.players.size > 0) {
    room.hostId = room.players.keys().next().value;
    console.log(`[host] ${room.code} host passed to ${room.hostId}`);
  }
  io.to(room.code).emit('player:left', { socketId: socket.id });
  io.to(room.code).emit('lobby:update', _lobbyState(room));
  if (room.players.size === 0) {
    clearInterval(room.tickInterval);
    rooms.delete(room.code);
  }
}

/* ── Helper: lobby state snapshot ── */
function _lobbyState(room) {
  return {
    code:    room.code,
    phase:   room.phase,
    players: Array.from(room.players.entries()).map(([sid, p]) => ({
      socketId: sid,
      playerId: p.id,
      role:     p.role,
      isHost:   sid === room.hostId,
    })),
  };
}

/* ── Start (skipped when loaded by the tests, which pick their own port) ── */
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\n🏦 Vault Run server running on http://localhost:${PORT}`);
    console.log(`   Single-player: open index.html directly (no server needed)`);
    console.log(`   Multiplayer:   players visit http://localhost:${PORT}\n`);
  });
}

module.exports = { server, io, rooms, playerBalances };
