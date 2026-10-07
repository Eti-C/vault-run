/* ══════════════════════════════════════════════════════════
   MenuScene — main menu with play money store access
══════════════════════════════════════════════════════════ */

class MenuScene extends Phaser.Scene {
  constructor() { super('MenuScene'); }

  create() {
    Utils.hideHUD();

    /* Phaser background */
    this.cameras.main.setBackgroundColor(VR.COLORS.sky);
    this._drawCityBg();

    /* DOM overlay */
    this.div = this.add.dom(VR.CANVAS_W / 2, VR.CANVAS_H / 2).createFromHTML(this._html());
    this.div.setOrigin(0.5);

    this._bind();
  }

  _drawCityBg() {
    const g = this.add.graphics();
    /* sky gradient simulation */
    g.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x16213e, 0x16213e, 1)
     .fillRect(0, 0, VR.CANVAS_W, VR.CANVAS_H);
    /* ground */
    g.fillStyle(0x2c3e50).fillRect(0, VR.GROUND_Y, VR.CANVAS_W, VR.CANVAS_H - VR.GROUND_Y);
    /* simple silhouette buildings */
    const heights = [120,80,140,60,110,90,130];
    let x = 0;
    for (const h of heights) {
      const w = Utils.randInt(60, 120);
      g.fillStyle(0x0d1526).fillRect(x, VR.GROUND_Y - h, w - 4, h);
      x += w;
      if (x > VR.CANVAS_W) break;
    }
  }

  _html() {
    const bal = Utils.dollars(Store.balance);
    return `
    <div class="vr-screen" style="background:transparent;">
      <div class="vr-title">💰 VAULT RUN</div>
      <div class="vr-subtitle">
        Collect cash · Deposit at banks · Dodge thieves & cops<br/>
        Earn <b style="color:var(--gold)">$VR play money</b> to spend in the store!
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:8px;">
        <button class="vr-btn" id="btn-play">▶ Play Game</button>
        <button class="vr-btn secondary" id="btn-store">🛒 Store (${bal})</button>
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:10px;">
        All currency is play money ($VR). No real money involved.
      </div>
    </div>`;
  }

  _bind() {
    this.div.addListener('click');
    this.div.on('click', e => {
      if (e.target.id === 'btn-play')  this.scene.start('LoadoutScene');
      if (e.target.id === 'btn-store') this.scene.start('StoreScene');
    });
  }
}
