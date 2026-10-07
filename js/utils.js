/* ═══════════════════════════════════════════════════
   VAULT RUN — Utility helpers
   Pure functions, no side effects.
═══════════════════════════════════════════════════ */

const Utils = {

  /* Format a $VR number nicely */
  dollars(n) {
    return '$' + Math.floor(n).toLocaleString() + ' VR';
  },

  /* Random integer between min and max inclusive */
  randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /* Random float */
  randFloat(min, max) {
    return Math.random() * (max - min) + min;
  },

  /* Clamp a value */
  clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  },

  /* Return the zone name for a world-X coordinate */
  zoneAt(worldX) {
    for (const z of VR.ZONES) {
      if (worldX >= z.x && worldX < z.x + z.w) return z.name;
    }
    return 'commercial';
  },

  /* Return cash value range for a given world-X */
  cashRange(worldX) {
    const zone = Utils.zoneAt(worldX);
    return VR.CASH.VALUES[zone] || VR.CASH.VALUES.commercial;
  },

  /* Is worldX inside an alleyway? */
  inAlley(worldX) {
    return VR.ALLEYWAYS.some(a => worldX >= a.x && worldX < a.x + a.w);
  },

  /* Show a toast notification in the DOM */
  toast(msg, type = '', duration = 3000) {
    const area = document.getElementById('toast-area');
    if (!area) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    area.appendChild(el);
    setTimeout(() => el.remove(), duration);
  },

  /* Update the DOM HUD fields */
  updateHUD(fields) {
    if (fields.role    != null) document.getElementById('hud-role').textContent        = fields.role;
    if (fields.carry   != null) document.getElementById('hud-carry-val').textContent   = Utils.dollars(fields.carry);
    if (fields.balance != null) document.getElementById('hud-balance-val').textContent = Utils.dollars(fields.balance);
    if (fields.timer   != null) {
      const s = Math.max(0, Math.floor(fields.timer));
      const m = Math.floor(s / 60);
      const sec = String(s % 60).padStart(2, '0');
      document.getElementById('hud-timer-val').textContent = `${m}:${sec}`;
    }
    if (fields.items != null) {
      document.getElementById('hud-items').textContent = fields.items;
    }
  },

  showHUD()  { document.getElementById('hud').classList.remove('hidden'); },
  hideHUD()  { document.getElementById('hud').classList.add('hidden'); },

};
