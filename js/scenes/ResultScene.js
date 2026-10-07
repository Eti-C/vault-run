/* ══════════════════════════════════════════════════════════
   ResultScene — post-round earnings summary + store access
══════════════════════════════════════════════════════════ */

class ResultScene extends Phaser.Scene {
  constructor() { super('ResultScene'); }

  init(data) { this.data = data; }

  create() {
    Utils.hideHUD();
    this.cameras.main.setBackgroundColor(VR.COLORS.sky);

    const d = this.data;
    const roleCfg = VR.ROLES[d.role];
    const diffCfg = VR.DIFFICULTY[d.difficulty];

    const html = `
    <div class="vr-screen" style="background:transparent;gap:14px;">
      <div class="vr-title" style="font-size:34px;">Round Over!</div>
      <div style="font-size:28px;">${roleCfg.emoji}</div>

      <div style="width:100%;max-width:400px;">
        <div class="result-row">
          <span class="label">Role</span>
          <span class="val">${roleCfg.label}</span>
        </div>
        <div class="result-row">
          <span class="label">Difficulty</span>
          <span class="val">${diffCfg.label} ×${diffCfg.earnMult}</span>
        </div>
        <div class="result-row">
          <span class="label">Earned this round</span>
          <span class="val" style="color:var(--green)">+${Utils.dollars(d.earned)}</span>
        </div>
        ${d.allOpen && d.role !== 'thief' ? `
        <div class="result-row">
          <span class="label">All Banks Open Bonus</span>
          <span class="val" style="color:var(--gold)">+${Utils.dollars(d.bonus)}</span>
        </div>` : ''}
        <div class="result-row" style="border-top:1px solid var(--gold-dark);margin-top:8px;padding-top:8px;">
          <span class="label">Total $VR Balance</span>
          <span class="val" style="font-size:18px;">${Utils.dollars(d.balance)}</span>
        </div>
      </div>

      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:10px;">
        <button class="vr-btn" id="btn-play-again">▶ Play Again</button>
        <button class="vr-btn secondary" id="btn-store">🛒 Store</button>
        <button class="vr-btn secondary" id="btn-menu">🏠 Menu</button>
      </div>
    </div>`;

    this.div = this.add.dom(VR.CANVAS_W/2, VR.CANVAS_H/2).createFromHTML(html);
    this.div.setOrigin(0.5);
    this.div.addListener('click');
    this.div.on('click', e => {
      if (e.target.id === 'btn-play-again') this.scene.start('LoadoutScene');
      if (e.target.id === 'btn-store')      this.scene.start('StoreScene');
      if (e.target.id === 'btn-menu')       this.scene.start('MenuScene');
    });
  }
}

/* ══════════════════════════════════════════════════════════
   StoreScene — buy persistent items with $VR earnings
══════════════════════════════════════════════════════════ */

class StoreScene extends Phaser.Scene {
  constructor() { super('StoreScene'); }

  create() {
    Utils.hideHUD();
    this.cameras.main.setBackgroundColor(VR.COLORS.sky);
    this._render();
  }

  _render() {
    /* Remove old DOM element if re-rendering */
    if (this.div) this.div.destroy();

    const items = Object.values(VR.STORE_ITEMS).map(item => {
      const owned = Store.owns(item.id);
      return `
      <div class="store-item">
        <div class="s-emoji">${item.emoji}</div>
        <div class="s-name">${item.name}</div>
        <div class="s-desc">${item.description}</div>
        <div class="s-price">${Utils.dollars(item.price)}</div>
        ${owned
          ? '<div class="s-owned">✅ Owned</div>'
          : `<button class="vr-btn" style="padding:6px 12px;font-size:12px;" data-buy="${item.id}">Buy</button>`
        }
      </div>`;
    }).join('');

    const html = `
    <div class="vr-screen" style="background:transparent;gap:14px;">
      <div class="vr-title" style="font-size:30px;">🛒 Store</div>
      <div style="color:var(--green);font-weight:bold;font-size:16px;">
        Balance: ${Utils.dollars(Store.balance)}
      </div>
      <div style="font-size:11px;color:var(--text-dim);">
        Items are permanent. Purchased once, owned forever.
      </div>
      <div class="store-grid">${items}</div>
      <button class="vr-btn secondary" id="btn-back" style="margin-top:8px;">← Back</button>
    </div>`;

    this.div = this.add.dom(VR.CANVAS_W/2, VR.CANVAS_H/2).createFromHTML(html);
    this.div.setOrigin(0.5);
    this.div.addListener('click');
    this.div.on('click', e => {
      if (e.target.id === 'btn-back') {
        this.scene.start('MenuScene');
        return;
      }
      const buyId = e.target.dataset && e.target.dataset.buy;
      if (buyId) {
        const result = Store.buyItem(buyId);
        if (result.ok) {
          Utils.toast(`✅ Bought ${VR.STORE_ITEMS[buyId].name}!`, 'good');
        } else {
          Utils.toast(`❌ ${result.reason}`, 'bad');
        }
        this._render(); // re-render to update owned states
      }
    });
  }
}
