/* ══════════════════════════════════════════════════════════
   Bank — storefront with health bar, accepts deposits
══════════════════════════════════════════════════════════ */

class Bank {
  constructor(scene, x, groundY, index) {
    this.scene  = scene;
    this.x      = x;
    this.y      = groundY;
    this.health = VR.BANKS.MAX_HEALTH;
    this.open   = true;
    this.index  = index;

    const bw = 70, bh = 80;

    /* Building */
    this.building = scene.add.rectangle(x, groundY - bh/2, bw, bh, 0x1a3a2a);

    /* Name sign */
    this.sign = scene.add.text(x, groundY - bh - 10, `🏦 Bank ${index+1}`, {
      fontSize: '11px', color: '#2ecc71',
    }).setOrigin(0.5);

    /* Health bar background */
    this.healthBarBg = scene.add.rectangle(x, groundY - bh - 24, 60, 8, 0x333333);

    /* Health bar fill */
    this.healthBar = scene.add.rectangle(x - 30, groundY - bh - 24, 60, 8, VR.COLORS.bankHealth);
    this.healthBar.setOrigin(0, 0.5);

    /* Deposit prompt */
    this.prompt = scene.add.text(x, groundY - 10, 'DEPOSIT', {
      fontSize: '9px', color: '#2ecc71',
    }).setOrigin(0.5).setAlpha(0);
  }

  /* Called each frame — health decays, bar updates */
  decay(dt) {
    if (!this.open) return;
    this.health -= VR.BANKS.DECAY_RATE * dt;
    if (this.health <= 0) {
      this.health = 0;
      this._close();
    }
    this._updateBar();
  }

  deposit(amount) {
    if (!this.open) return;
    this.health = Math.min(VR.BANKS.MAX_HEALTH, this.health + VR.BANKS.DEPOSIT_HEAL);
    this._updateBar();
    this._flashDeposit();
  }

  _updateBar() {
    const frac = this.health / VR.BANKS.MAX_HEALTH;
    this.healthBar.setSize(60 * frac, 8);
    const col = frac > 0.5 ? VR.COLORS.bankHealth
              : frac > 0.25 ? 0xf39c12
              : VR.COLORS.red;
    this.healthBar.setFillStyle(col);
  }

  _close() {
    this.open = false;
    this.building.setFillStyle(VR.COLORS.bankDead);
    this.sign.setText('🔒 Closed').setColor('#555555');
    this.healthBar.setFillStyle(0x444444);
    Utils.toast(`🔒 Bank ${this.index+1} closed!`, 'bad');
  }

  _flashDeposit() {
    this.building.setFillStyle(0x2ecc71);
    this.scene.time.delayedCall(400, () => {
      if (this.open) this.building.setFillStyle(0x1a3a2a);
    });
  }
}
