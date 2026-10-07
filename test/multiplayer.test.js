/* Multiplayer server tests — run with:  npm test
   Starts the real server.js on a random port and drives it with fake players. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.VR_ROUND_TIME = '3';   // short rounds so tests finish fast
const { server, io, rooms } = require('../server');
const ioc = require('socket.io-client');

let url;
const sockets = [];
let nextId = 0;

before(() => new Promise(r => server.listen(0, () => {
  url = `http://localhost:${server.address().port}`;
  r();
})));

after(() => {
  sockets.forEach(s => s.disconnect());
  return new Promise(r => io.close(() => r()));
});

/* ── helpers ── */
function waitFor(socket, event, match = () => true, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, ms);
    function handler(data) {
      if (!match(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

function ask(socket, event, data) {
  return new Promise(resolve => socket.emit(event, data, resolve));
}

async function player() {
  const s = ioc(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  await waitFor(s, 'connect');
  s.playerId = `p_test_${nextId++}`;
  return s;
}

async function host(opts = {}) {
  const s = await player();
  const res = await ask(s, 'room:create', { playerId: s.playerId, role: 'banker', items: [], balance: 0, ...opts });
  assert.equal(res.ok, true);
  return { s, code: res.code };
}

async function join(code, opts = {}) {
  const s = await player();
  const res = await ask(s, 'room:join', { code, playerId: s.playerId, role: 'banker', items: [], balance: 0, ...opts });
  return { s, res };
}

async function startRound(hostSocket, ...others) {
  const all = [hostSocket, ...others].map(s => waitFor(s, 'round:start'));
  hostSocket.emit('round:start');
  await Promise.all(all);
}

/* ── lobby ── */
test('host creates a room with a 6-character code', async () => {
  const { s, code } = await host();
  assert.match(code, /^[0-9A-F]{6}$/);
  assert.ok(rooms.has(code));
  s.disconnect();
});

test('guest can join with a lowercase code and both see the roster', async () => {
  const { s: h, code } = await host();
  const hostSees = waitFor(h, 'lobby:update', st => st.players.length === 2);
  const { s: g, res } = await join(code.toLowerCase());
  assert.equal(res.ok, true);
  const state = await hostSees;
  assert.deepEqual(state.players.map(p => p.isHost), [true, false]);
  h.disconnect(); g.disconnect();
});

test('joining a room that does not exist is refused', async () => {
  const { s, res } = await join('ZZZZZZ');
  assert.deepEqual(res, { ok: false, reason: 'Room not found' });
  s.disconnect();
});

test('a malformed join does not crash the server', async () => {
  const s = await player();
  const res = await ask(s, 'room:join', {});
  assert.equal(res.ok, false);
  const { s: h } = await host();           // server still answering
  h.disconnect(); s.disconnect();
});

test('role picked in the lobby reaches everyone; bad roles are ignored', async () => {
  const { s: h, code } = await host();
  const { s: g } = await join(code);
  const seen = waitFor(h, 'lobby:update', st => st.players.some(p => p.role === 'thief'));
  g.emit('player:role', { role: 'thief' });
  await seen;
  g.emit('player:role', { role: 'admin' });
  await new Promise(r => setTimeout(r, 100));
  const p = rooms.get(code).players.get(g.id);
  assert.equal(p.role, 'thief');
  h.disconnect(); g.disconnect();
});

test('a room is full at 8 players', async () => {
  const { s: h, code } = await host();
  const guests = [];
  for (let i = 0; i < 7; i++) guests.push((await join(code)).s);
  const { s: ninth, res } = await join(code);
  assert.deepEqual(res, { ok: false, reason: 'Room full' });
  [h, ninth, ...guests].forEach(s => s.disconnect());
});

/* ── host ── */
test('only the host can start the round', async () => {
  const { s: h, code } = await host();
  const { s: g } = await join(code);
  g.emit('round:start');
  await new Promise(r => setTimeout(r, 150));
  assert.equal(rooms.get(code).phase, 'lobby');
  await startRound(h, g);
  assert.equal(rooms.get(code).phase, 'running');
  h.disconnect(); g.disconnect();
});

test('when the host leaves, the next player becomes host and can start', async () => {
  const { s: h, code } = await host();
  const { s: g } = await join(code);
  const promoted = waitFor(g, 'lobby:update', st => st.players.length === 1 && st.players[0].isHost);
  h.disconnect();
  await promoted;
  await startRound(g);
  g.disconnect();
});

test('a room is deleted when everyone leaves', async () => {
  const { s: h, code } = await host();
  h.disconnect();
  await new Promise(r => setTimeout(r, 150));
  assert.equal(rooms.has(code), false);
});

/* ── in-round ── */
test('movement is relayed to the other players', async () => {
  const { s: h, code } = await host();
  const { s: g } = await join(code);
  await startRound(h, g);
  const moved = waitFor(g, 'player:moved', m => m.socketId === h.id);
  h.emit('player:move', { x: 1234, y: 348, carry: 50 });
  const m = await moved;
  assert.equal(m.x, 1234);
  assert.equal(m.carry, 50);
  h.disconnect(); g.disconnect();
});

test('a guest can late-join a running round', async () => {
  const { s: h, code } = await host();
  await startRound(h);
  const { s: g, res } = await join(code);
  assert.equal(res.ok, true);
  assert.equal(res.phase, 'running');
  h.disconnect(); g.disconnect();
});

test('banker deposit pays 10% x2 and heals the bank', async () => {
  const { s: h, code } = await host();
  await startRound(h);
  rooms.get(code).banks[0].health = 50;
  const confirmed = waitFor(h, 'deposit:confirmed');
  h.emit('deposit', { bankId: 0, amount: 300 });
  const { cut } = await confirmed;
  assert.equal(cut, 60);
  assert.equal(rooms.get(code).banks[0].health, 65);
  h.disconnect();
});

test('thief robs a worker for their whole carry', async () => {
  const { s: worker, code } = await host({ role: 'truck' });
  const { s: thief } = await join(code, { role: 'thief' });
  await startRound(worker, thief);
  worker.emit('player:move', { x: 2000, y: 348, carry: 400 });
  thief.emit('player:move', { x: 2020, y: 348, carry: 0 });
  await new Promise(r => setTimeout(r, 100));
  const victim = waitFor(worker, 'robbery:victim');
  const success = waitFor(thief, 'robbery:success');
  thief.emit('robbery:attempt', { victimSocketId: worker.id });
  assert.equal((await success).take, 400);
  assert.equal((await victim).lost, 400);
  worker.disconnect(); thief.disconnect();
});

test('security vest limits a robbery to 60%; phone fines the thief', async () => {
  const { s: worker, code } = await host({ role: 'banker', items: ['vest', 'phone'] });
  const { s: thief } = await join(code, { role: 'thief' });
  await startRound(worker, thief);
  worker.emit('player:move', { x: 2000, y: 348, carry: 500 });
  thief.emit('player:move', { x: 2020, y: 348, carry: 0 });
  await new Promise(r => setTimeout(r, 100));
  const success = waitFor(thief, 'robbery:success');
  const fined   = waitFor(thief, 'fine:reported');
  thief.emit('robbery:attempt', { victimSocketId: worker.id });
  assert.equal((await success).take, 300);
  assert.ok((await fined).amount > 0);
  worker.disconnect(); thief.disconnect();
});

test('robbery from too far away is rejected', async () => {
  const { s: worker, code } = await host();
  const { s: thief } = await join(code, { role: 'thief' });
  await startRound(worker, thief);
  worker.emit('player:move', { x: 500, y: 348, carry: 400 });
  thief.emit('player:move', { x: 3000, y: 348, carry: 0 });
  await new Promise(r => setTimeout(r, 100));
  thief.emit('robbery:attempt', { victimSocketId: worker.id });
  await assert.rejects(waitFor(thief, 'robbery:success', undefined, 300));
  worker.disconnect(); thief.disconnect();
});

test('a thief standing next to a cop is fined', async () => {
  const { s: thief, code } = await host({ role: 'thief', balance: 1000 });
  await startRound(thief);
  const copX = rooms.get(code).cops[0].x;
  const fine = waitFor(thief, 'fine:cop', f => f.type === 'initial');
  thief.emit('player:move', { x: copX, y: 348, carry: 0 });
  assert.ok((await fine).amount >= 400);   // 40% of 1000
  thief.disconnect();
});

/* ── round end ── */
test('round ends on time and pays earnings on top of the player balance', async () => {
  const { s: h, code } = await host({ balance: 5000 });
  await startRound(h);
  h.emit('deposit', { bankId: 0, amount: 1000 });
  const end = await waitFor(h, 'round:end', undefined, 6000);
  assert.ok(end.earned > 0);
  assert.equal(end.newBalance, 5000 + end.earned);
  assert.equal(rooms.get(code).phase, 'ended');
  h.disconnect();
});

test('a player can host and start a new room right after a round ends', async () => {
  const { s: h } = await host();
  await startRound(h);
  await waitFor(h, 'round:end', undefined, 6000);

  const res = await ask(h, 'room:create', { playerId: h.playerId, role: 'banker', items: [], balance: 0 });
  assert.equal(res.ok, true);
  const { s: g } = await join(res.code);
  await startRound(h, g);
  assert.equal(rooms.get(res.code).phase, 'running');
  h.disconnect(); g.disconnect();
});
