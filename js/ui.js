/* ═══════════════════════════════════════════════════════════════
   UI — Screen manager & HTML screen logic
   All menus / loadout / store / result are plain HTML divs.
   Phaser only handles the actual game canvas.
═══════════════════════════════════════════════════════════════ */

const UI = (() => {

  /* Currently selected options */
  let _role = 'banker';
  let _diff = 'medium';

  /* ── Screen switching ── */
  function _hideAll() {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    Utils.hideHUD();
    document.getElementById('minimap').style.display = 'none';
  }

  function show(id) {
    _hideAll();
    document.getElementById(id).classList.remove('hidden');
  }

  /* ── Menu ── */
  function showMenu() {
    show('screen-menu');
    document.getElementById('menu-balance').textContent = Utils.dollars(Store.balance);
  }

  /* ── Loadout ── */
  function showLoadout() {
    show('screen-loadout');
    _renderRoleCards();
    _renderDiffButtons();
  }

  function _renderRoleCards() {
    const container = document.getElementById('role-cards');
    container.innerHTML = Object.entries(VR.ROLES).map(([id, r]) => `
      <div class="role-card ${id === _role ? 'selected' : ''}" onclick="UI._selectRole('${id}')">
        <div class="role-emoji">${r.emoji}</div>
        <div class="role-name">${r.label.replace(/^\S+\s/, '')}</div>
        <div class="role-desc">${r.description}</div>
      </div>`).join('');
  }

  function _renderDiffButtons() {
    const container = document.getElementById('diff-row');
    container.innerHTML = Object.entries(VR.DIFFICULTY).map(([id, d]) => `
      <button class="diff-btn ${id === _diff ? 'selected' : ''}" onclick="UI._selectDiff('${id}')">
        ${d.label}
      </button>`).join('');
  }

  function _selectRole(id) {
    _role = id;
    _renderRoleCards();
  }

  function _selectDiff(id) {
    _diff = id;
    _renderDiffButtons();
  }

  function startGame() {
    _hideAll();
    /* Tell Phaser to start / restart GameScene */
    if (window.game) {
      const gs = window.game.scene.getScene('GameScene');
      if (gs && gs.sys.isActive()) {
        window.game.scene.stop('GameScene');
      }
      window.game.scene.start('GameScene', { role: _role, difficulty: _diff });
    }
    document.getElementById('minimap').style.display = 'block';
    Utils.showHUD();
  }

  /* ── Store ── */
  function showStore() {
    show('screen-store');
    document.getElementById('store-balance-val').textContent = Utils.dollars(Store.balance);
    _renderStoreGrid();
  }

  function _renderStoreGrid() {
    const grid = document.getElementById('store-grid');
    grid.innerHTML = Object.values(VR.STORE_ITEMS).map(item => {
      const owned = Store.owns(item.id);
      return `
      <div class="store-item">
        <div class="s-emoji">${item.emoji}</div>
        <div class="s-name">${item.name}</div>
        <div class="s-desc">${item.description}</div>
        <div class="s-price">${Utils.dollars(item.price)}</div>
        ${owned
          ? '<div class="s-owned">✅ Owned</div>'
          : `<button class="vr-btn" style="padding:6px 12px;font-size:12px"
               onclick="UI._buyItem('${item.id}')">Buy</button>`
        }
      </div>`;
    }).join('');
  }

  function _buyItem(id) {
    const result = Store.buyItem(id);
    if (result.ok) {
      Utils.toast(`✅ Bought ${VR.STORE_ITEMS[id].name}!`, 'good');
    } else {
      Utils.toast(`❌ ${result.reason}`, 'bad');
    }
    /* Refresh store display */
    document.getElementById('store-balance-val').textContent = Utils.dollars(Store.balance);
    _renderStoreGrid();
  }

  /* ── Result screen ── */
  function showResult(data) {
    show('screen-result');
    const roleCfg = VR.ROLES[data.role];
    const diffCfg = VR.DIFFICULTY[data.difficulty]
      || { label: 'Multiplayer', earnMult: (data.mult || 1).toFixed(2) };

    document.getElementById('result-role-emoji').textContent = roleCfg.emoji;

    const rows = [
      ['Role',                roleCfg.label],
      ['Difficulty',          `${diffCfg.label} ×${diffCfg.earnMult}`],
      ['Earned this round',   `<span style="color:var(--green)">+${Utils.dollars(data.earned)}</span>`],
      data.allOpen && data.role !== 'thief'
        ? ['All Banks Bonus', `<span style="color:var(--gold)">+${Utils.dollars(data.bonus)}</span>`]
        : null,
      ['Total $VR Balance',   `<span style="font-size:17px">${Utils.dollars(data.balance)}</span>`],
    ].filter(Boolean);

    document.getElementById('result-rows').innerHTML = rows.map(([l, v]) => `
      <div class="result-row">
        <span class="label">${l}</span>
        <span class="val">${v}</span>
      </div>`).join('');
  }

  /* ══════════════════════════════════════════════
     MULTIPLAYER SCREENS
  ══════════════════════════════════════════════ */

  let _mpRole = 'banker';

  function showMultiplayer() {
    show('screen-mp-connect');
    document.getElementById('mp-join-row').classList.add('hidden');

    const connected = document.getElementById('mp-connected-panel');
    const noserver  = document.getElementById('mp-noserver-panel');

    connected.style.display = 'none';
    noserver.style.display  = 'none';
    try {
      document.getElementById('mp-server-addr').value =
        (localStorage.getItem('vr_mp_server') || '').replace(/^https?:\/\//, '');
    } catch (e) {}

    /* Wait for the Socket.io client to finish loading (see index.html) */
    window.MP_IO_READY.then(ok => {
      if (ok) {
        connected.classList.remove('hidden');
        connected.style.display = 'flex';
        MP.connect(window.MP_ORIGIN);
      } else {
        noserver.classList.remove('hidden');
        noserver.style.display = 'flex';
      }
    });
  }

  /* mpConnect no longer needed — kept as a no-op for safety */
  function mpConnect() {}

  /* Save a server address (blank = auto-detect) and reload to load Socket.io from it */
  function mpSetServer() {
    let addr = document.getElementById('mp-server-addr').value.trim().replace(/\/+$/, '');
    if (addr && !/^https?:\/\//i.test(addr)) addr = 'http://' + addr;
    try {
      if (addr) localStorage.setItem('vr_mp_server', addr);
      else localStorage.removeItem('vr_mp_server');
    } catch (e) {}
    sessionStorage.setItem('vr_open_mp', '1');
    location.reload();
  }

  function mpHost() {
    show('screen-mp-lobby');
    _renderMpRoleCards();
    document.getElementById('lobby-code').textContent = '…';
    document.getElementById('btn-mp-start').style.display   = 'block';
    document.getElementById('btn-mp-waiting').style.display = 'none';

    MP.createRoom({ role: _mpRole }, res => {
      if (!res.ok) { Utils.toast(res.reason, 'bad'); showMultiplayer(); return; }
      document.getElementById('lobby-code').textContent = res.code;
    });
  }

  function mpShowJoin() {
    const row = document.getElementById('mp-join-row');
    row.classList.toggle('hidden');
    row.style.display = row.classList.contains('hidden') ? 'none' : 'flex';
  }

  function mpJoin() {
    const code = document.getElementById('mp-room-code').value.trim().toUpperCase();
    if (!code) { Utils.toast('Enter a room code', 'warn'); return; }

    MP.joinRoom(code, { role: _mpRole }, res => {
      if (!res.ok) { Utils.toast(res.reason, 'bad'); return; }
      show('screen-mp-lobby');
      _renderMpRoleCards();
      document.getElementById('lobby-code').textContent = code;
      document.getElementById('btn-mp-start').style.display   = 'none';
      document.getElementById('btn-mp-waiting').style.display = 'block';

      /* If round is already running, jump straight in */
      if (res.phase === 'running') {
        _startMpGame();
      }
    });
  }

  function _renderMpRoleCards() {
    const container = document.getElementById('mp-role-cards');
    container.innerHTML = Object.entries(VR.ROLES).map(([id, r]) => `
      <div class="role-card ${id === _mpRole ? 'selected' : ''}" onclick="UI._selectMpRole('${id}')">
        <div class="role-emoji">${r.emoji}</div>
        <div class="role-name">${r.label.replace(/^\S+\s/, '')}</div>
      </div>`).join('');
  }

  function _selectMpRole(id) {
    _mpRole = id;
    MP.setRole(id);
    _renderMpRoleCards();
  }

  function mpStartRound() {
    MP.startRound();
    _startMpGame();
  }

  function _startMpGame() {
    _hideAll();
    if (window.game) {
      const gs = window.game.scene.getScene('GameScene');
      if (gs && gs.sys.isActive()) window.game.scene.stop('GameScene');
      window.game.scene.start('GameScene', {
        role:        _mpRole,
        difficulty:  'multiplayer',
        multiplayer: true,
      });
    }
    document.getElementById('minimap').style.display = 'block';
    Utils.showHUD();
  }

  function updateLobby(state, isHost) {
    /* Update code display if we now know it */
    if (state.code) document.getElementById('lobby-code').textContent = state.code;

    /* Host can change hands if the old host leaves */
    if (state.phase === 'lobby') {
      document.getElementById('btn-mp-start').style.display   = isHost ? 'block' : 'none';
      document.getElementById('btn-mp-waiting').style.display = isHost ? 'none'  : 'block';
    }

    const list = document.getElementById('lobby-players');
    if (!list) return;
    list.innerHTML = state.players.map(p => `
      <div class="lobby-player">
        <span>${VR.ROLES[p.role]?.emoji || '👤'}</span>
        <span>${p.isHost ? '👑 ' : ''}${p.playerId.slice(-6)}</span>
        <span style="color:var(--text-dim);font-size:11px">${VR.ROLES[p.role]?.label || p.role}</span>
      </div>`).join('');
  }

  function mpLeave() {
    MP.disconnect();
    showMenu();
  }

  /* ── Public surface ── */
  return {
    showMenu, showLoadout, showStore, showResult, startGame,
    showMultiplayer, mpConnect, mpSetServer, mpHost, mpShowJoin, mpJoin,
    mpStartRound, mpLeave, updateLobby, startMpGame: _startMpGame,
    _selectRole, _selectDiff, _buyItem, _selectMpRole,
  };

})();

/* Show menu on first load */
document.addEventListener('DOMContentLoaded', () => {
  /* After "Connect" reloads the page, go straight back to the Multiplayer screen */
  if (sessionStorage.getItem('vr_open_mp')) {
    sessionStorage.removeItem('vr_open_mp');
    UI.showMultiplayer();
  } else {
    UI.showMenu();
  }
});
