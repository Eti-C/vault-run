/* ═══════════════════════════════════════════════════════════════
   VAULT RUN — Player Store / Persistence
   ─────────────────────────────────────────────────────────────
   Uses localStorage so balances and inventory survive page refresh.
   In a real website integration, swap the load/save methods to call
   your backend API instead (see INTEGRATION NOTE below).
═══════════════════════════════════════════════════════════════ */

const Store = (() => {

  const SAVE_KEY = 'vaultrun_player';

  /* Default player data */
  function defaultData() {
    return {
      balance:   VR.STARTING_BALANCE,
      inventory: [],          // array of item IDs owned
      sessions:  0,
      totalEarned: 0,
    };
  }

  /* ── INTEGRATION NOTE ──────────────────────────────────────
     To connect to a real backend:
     1. Replace load() with: const res = await fetch('/api/player'); return res.json();
     2. Replace save() with: await fetch('/api/player', { method:'POST', body: JSON.stringify(data) });
     3. Add auth headers as needed (cookie / JWT).
     ──────────────────────────────────────────────────────── */

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultData();
      return { ...defaultData(), ...JSON.parse(raw) };
    } catch {
      return defaultData();
    }
  }

  function save(data) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  }

  /* ── Public API ── */
  let _data = load();

  return {

    get balance()   { return _data.balance; },
    get inventory() { return _data.inventory; },

    owns(itemId) {
      return _data.inventory.includes(itemId);
    },

    /* Add earnings at round end */
    addEarnings(amount) {
      _data.balance += Math.floor(amount);
      _data.totalEarned += Math.floor(amount);
      _data.sessions++;
      save(_data);
    },

    /* Buy an item from the store */
    buyItem(itemId) {
      const item = VR.STORE_ITEMS[itemId];
      if (!item) return { ok: false, reason: 'Unknown item' };
      if (this.owns(itemId)) return { ok: false, reason: 'Already owned' };
      if (_data.balance < item.price) return { ok: false, reason: 'Not enough $VR' };
      _data.balance -= item.price;
      _data.inventory.push(itemId);
      save(_data);
      return { ok: true };
    },

    /* Build equipped-items emoji string for HUD */
    itemsHUD(role) {
      return _data.inventory
        .filter(id => {
          const it = VR.STORE_ITEMS[id];
          return it && (it.available.includes(role) || it.available.includes('all'));
        })
        .map(id => VR.STORE_ITEMS[id].emoji)
        .join('');
    },

    /* Apply item effects to a role's stats */
    applyItems(role, stats) {
      const out = { ...stats };

      if (this.owns('shoes')) out.speed = Math.round(out.speed * 1.15);
      if (this.owns('bag') && role !== 'thief') out.carryLimit = Math.round(out.carryLimit * 1.4);

      /* scanner: handled in GameScene minimap logic */
      /* vest:    handled in robbery logic */
      /* disguise: handled in GameScene post-robbery */

      return out;
    },

    /* Reset (for dev / debug) */
    reset() {
      _data = defaultData();
      save(_data);
    },

    reload() {
      _data = load();
    },

    /* Expose raw data for result screen */
    data() { return { ..._data }; },
  };

})();
