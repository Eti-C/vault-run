/* ════════════════════════════════════════════════════════════════
   MULTIPLAYER CLIENT — js/multiplayer.js
   ─────────────────────────────────────────────────────────────
   Wraps Socket.io. GameScene checks MP.isConnected() to decide
   whether to use CPU opponents or real remote players.

   Single-player: MP.isConnected() === false  → CPUs run locally
   Multiplayer:   MP.isConnected() === true   → server is authority

   Usage flow:
     MP.connect(serverUrl)          → connects socket
     MP.createRoom(opts, cb)        → host creates room, gets code
     MP.joinRoom(code, opts, cb)    → guest joins by code
     MP.startRound()                → host starts (ignored if guest)
     MP.sendMove(x, y, carry)       → called every frame in GameScene
     MP.sendDeposit(bankId, amount) → called on deposit
     MP.attemptRobbery(victimId)    → called on proximity
     MP.sendReport(thiefId)         → R key
     MP.sendTipOff()                → T key
     MP.disconnect()                → leave room / return to solo
════════════════════════════════════════════════════════════════ */

const MP = (() => {

  /* ── State ── */
  let _socket       = null;
  let _connected    = false;
  let _roomCode     = null;
  let _isHost       = false;
  let _playerId     = null;  // persistent ID stored in localStorage
  let _remotePlayers = new Map();  // socketId → { role, x, y, carry, sprite, label }
  let _scene        = null;        // ref to the active GameScene

  /* ── Persistent player ID (so server can track balance) ── */
  function getPlayerId() {
    let id = localStorage.getItem('vr_player_id');
    if (!id) {
      id = 'p_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('vr_player_id', id);
    }
    return id;
  }

  /* ══════════════════════════════════════════════
     CONNECTION
  ══════════════════════════════════════════════ */
  function connect(serverUrl) {
    if (_socket) return;
    /* Socket.io client is loaded from the server when multiplayer is used */
    if (typeof io === 'undefined') {
      Utils.toast('Socket.io not loaded — multiplayer unavailable', 'bad');
      return false;
    }
    _playerId = getPlayerId();
    _socket   = io(serverUrl, { transports: ['websocket'] });

    const status = document.getElementById('mp-status');
    _socket.on('connect', () => {
      _connected = true;
      if (status) status.textContent = 'Connected to server ✅';
    });
    _socket.on('disconnect', () => {
      _connected = false;
      _roomCode  = null;
      Utils.toast('Disconnected from server', 'bad');
      if (_scene && window.game) window.game.scene.stop('GameScene');
      UI.showMenu();
    });
    _socket.on('connect_error', () => {
      if (status) status.textContent = 'Could not reach server ❌';
      Utils.toast('Could not reach server', 'bad');
    });

    _bindGameEvents();
    return true;
  }

  function disconnect() {
    if (_socket) { _socket.disconnect(); _socket = null; }
    _connected     = false;
    _roomCode      = null;
    _isHost        = false;
    _remotePlayers = new Map();
  }

  function isConnected() { return _connected && _roomCode !== null; }
  function isHost()      { return _isHost; }
  function roomCode()    { return _roomCode; }
  function playerId()    { return _playerId; }

  /* ══════════════════════════════════════════════
     ROOM MANAGEMENT
  ══════════════════════════════════════════════ */
  function createRoom(opts, cb) {
    if (!_socket) return cb({ ok: false, reason: 'Not connected' });
    _isHost = true;
    _socket.emit('room:create', {
      playerId: _playerId,
      role:     opts.role,
      items:    Store.inventory,
      balance:  Store.balance,
    }, res => {
      if (res.ok) _roomCode = res.code;
      cb(res);
    });
  }

  function joinRoom(code, opts, cb) {
    if (!_socket) return cb({ ok: false, reason: 'Not connected' });
    _isHost = false;
    _socket.emit('room:join', {
      code,
      playerId: _playerId,
      role:     opts.role,
      items:    Store.inventory,
      balance:  Store.balance,
    }, res => {
      if (res.ok) _roomCode = res.code;
      cb(res);
    });
  }

  function setRole(role) {
    if (_socket && _roomCode) _socket.emit('player:role', { role });
  }

  function startRound() {
    if (!_socket || !_isHost) return;
    _socket.emit('round:start');
  }

  /* ══════════════════════════════════════════════
     IN-GAME EVENTS (called by GameScene)
  ══════════════════════════════════════════════ */
  function sendMove(x, y, carry) {
    if (!isConnected()) return;
    _socket.emit('player:move', { x, y, carry });
  }

  function sendDeposit(bankId, amount) {
    if (!isConnected()) return;
    _socket.emit('deposit', { bankId, amount });
  }

  function attemptRobbery(victimSocketId) {
    if (!isConnected()) return;
    _socket.emit('robbery:attempt', { victimSocketId });
  }

  function sendReport(thiefSocketId) {
    if (!isConnected()) return;
    _socket.emit('robbery:report', { thiefSocketId });
  }

  function sendTipOff() {
    if (!isConnected()) return;
    _socket.emit('tipoff:request');
  }

  /* ══════════════════════════════════════════════
     INBOUND SERVER EVENTS
  ══════════════════════════════════════════════ */
  function _bindGameEvents() {

    /* Lobby updates — show who's in the room */
    _socket.on('lobby:update', state => {
      /* Keep the remote-player list in sync with the room roster */
      const present = new Set();
      state.players.forEach(p => {
        if (p.socketId === _socket.id) return;
        present.add(p.socketId);
        _addRemotePlayer(p.socketId, p.role, VR.WORLD_W / 2, VR.GROUND_Y - 22);
      });
      [..._remotePlayers.keys()].forEach(sid => {
        if (!present.has(sid)) _removeRemotePlayer(sid);
      });

      const me = state.players.find(p => p.socketId === _socket.id);
      const wasHost = _isHost;
      _isHost = !!(me && me.isHost);
      if (_isHost && !wasHost) Utils.toast('👑 You are now the host', 'good');

      UI.updateLobby(state, _isHost);
    });

    _socket.on('player:joined', data => {
      _addRemotePlayer(data.socketId, data.role, data.x, VR.GROUND_Y - 22);
      Utils.toast(`${VR.ROLES[data.role]?.emoji || '👤'} Player joined!`, 'good');
    });

    /* Player left */
    _socket.on('player:left', ({ socketId }) => {
      _removeRemotePlayer(socketId);
      Utils.toast('A player left the game.', 'warn');
    });

    /* Server starts the round */
    _socket.on('round:start', data => {
      /* GameScene should already be started by UI; if not, start it */
      Utils.toast('Round starting!', 'good');
      if (_scene) {
        _scene.onServerRoundStart(data);
      } else {
        /* Guests are still on the lobby screen — start their game now */
        UI.startMpGame();
      }
    });

    /* Cop positions from server (authoritative in MP) */
    _socket.on('cops:update', cops => {
      if (_scene) _scene.onCopsUpdate(cops);
    });

    /* Bank health from server */
    _socket.on('banks:update', banks => {
      if (_scene) _scene.onBanksUpdate(banks);
    });

    _socket.on('bank:closed', ({ bankId }) => {
      if (_scene) _scene.onBankClosed(bankId);
    });

    /* Remote player moved */
    _socket.on('player:moved', ({ socketId, x, y, carry }) => {
      const rp = _remotePlayers.get(socketId);
      if (rp) { rp.targetX = x; rp.targetY = y; rp.carry = carry; }
    });

    /* Cop fine — server tells this player they were fined */
    _socket.on('fine:cop', ({ amount, type }) => {
      if (_scene) _scene.onCopFine(amount, type);
    });

    /* Robbery events */
    _socket.on('robbery:success', ({ take, victimId }) => {
      if (_scene) _scene.onRobberySuccess(take);
      Utils.toast(`🦹 Robbed! +${Utils.dollars(take)}`, 'good');
    });

    _socket.on('robbery:victim', ({ thiefId, lost }) => {
      if (_scene) _scene.onRobberyVictim(lost);
      Utils.toast(`💸 Robbed! Lost ${Utils.dollars(lost)}`, 'bad');
    });

    _socket.on('fine:reported', ({ amount }) => {
      if (_scene) _scene.onReportedFine(amount);
      Utils.toast(`📱 Reported! Fine: -${Utils.dollars(amount)}`, 'bad');
    });

    _socket.on('report:confirmed', ({ fine }) => {
      Utils.toast(`📱 Report filed! Fine issued.`, 'good');
    });

    _socket.on('deposit:confirmed', ({ cut, newCarry }) => {
      if (_scene) _scene.onDepositConfirmed(cut, newCarry);
    });

    _socket.on('tipoff:received', ({ cops }) => {
      cops.forEach(c => {
        const zone = Utils.zoneAt(c.x);
        Utils.toast(`🚔 Tip: cop in ${zone}`, 'warn', 4000);
      });
    });

    /* Round end */
    _socket.on('round:end', data => {
      if (_scene) _scene.onRoundEnd(data);
      else Store.addEarnings(data.earned);
    });
  }

  /* ══════════════════════════════════════════════
     REMOTE PLAYER SPRITES (created inside GameScene)
  ══════════════════════════════════════════════ */
  function attachScene(scene) {
    _scene = scene;
    /* Create sprites for already-known remote players */
    _remotePlayers.forEach((rp, sid) => {
      _createSprite(scene, sid, rp);
    });
  }

  function detachScene() {
    _scene = null;
    /* Sprites die with the scene — drop the stale references */
    _remotePlayers.forEach(rp => { rp.sprite = null; rp.label = null; });
  }

  function _addRemotePlayer(socketId, role, x, y) {
    const existing = _remotePlayers.get(socketId);
    if (existing) {
      if (existing.role !== role) {
        existing.role = role;
        if (existing.sprite) existing.sprite.destroy();
        if (existing.label)  existing.label.destroy();
        if (_scene) _createSprite(_scene, socketId, existing);
      }
      return;
    }
    const rp = { role, x, y, targetX: x, targetY: y, carry: 0, sprite: null, label: null };
    _remotePlayers.set(socketId, rp);
    if (_scene) _createSprite(_scene, socketId, rp);
  }

  function _createSprite(scene, socketId, rp) {
    const col = (VR.ROLES[rp.role] || VR.ROLES.banker).color;
    rp.sprite = scene.add.rectangle(rp.x, rp.y, 20, 32, col).setAlpha(0.85);
    rp.label  = scene.add.text(rp.x, rp.y - 26,
      (VR.ROLES[rp.role]?.emoji || '👤'), { fontSize: '14px' }).setOrigin(0.5).setAlpha(0.85);
  }

  function _removeRemotePlayer(socketId) {
    const rp = _remotePlayers.get(socketId);
    if (rp) {
      if (rp.sprite) rp.sprite.destroy();
      if (rp.label)  rp.label.destroy();
      _remotePlayers.delete(socketId);
    }
  }

  /* Called each frame by GameScene to interpolate remote players */
  function updateRemotePlayers(dt) {
    _remotePlayers.forEach(rp => {
      if (!rp.sprite) return;
      /* Simple lerp toward server-authoritative position */
      const speed = 12;
      rp.x += (rp.targetX - rp.x) * Math.min(1, speed * dt);
      rp.y += (rp.targetY - rp.y) * Math.min(1, speed * dt);
      rp.sprite.setPosition(rp.x, rp.y);
      rp.label.setPosition(rp.x, rp.y - 26);
    });
  }

  /* Returns array of remote player state for robbery proximity checks */
  function getRemotePlayers() {
    return Array.from(_remotePlayers.entries()).map(([sid, rp]) => ({
      socketId: sid,
      role:     rp.role,
      x:        rp.x,
      y:        rp.y,
      carry:    rp.carry,
    }));
  }

  /* ── Public surface ── */
  return {
    connect, disconnect,
    isConnected, isHost, roomCode, playerId,
    createRoom, joinRoom, setRole, startRound,
    sendMove, sendDeposit, attemptRobbery, sendReport, sendTipOff,
    attachScene, detachScene,
    updateRemotePlayers, getRemotePlayers,
    getPlayerId,
  };

})();
