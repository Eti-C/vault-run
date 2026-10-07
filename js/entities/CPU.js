/* ══════════════════════════════════════════════════════════
   CPU — AI-controlled opponent
   Uses simple rule-based behaviour scaled by skillLevel (0–1).
   Banker/Truck CPUs: collect cash → deposit at nearest open bank.
   Thief CPUs: patrol street, intercept workers with high carry.
══════════════════════════════════════════════════════════ */

class CPU {
  constructor(scene, x, y, roleId, skillLevel) {
    this.scene      = scene;
    this.roleId     = roleId;
    this.skill      = skillLevel;
    this.carry      = 0;
    this.carryLimit = VR.ROLES[roleId].carryLimit;
    this.speed      = VR.ROLES[roleId].speed * (0.7 + skillLevel * 0.5);

    /* Randomly equip items based on skill */
    this.hasPhone = roleId !== 'thief' && Math.random() < skillLevel;
    this.hasVest  = roleId !== 'thief' && Math.random() < skillLevel * 0.5;

    const col = VR.ROLES[roleId].color;
    this.sprite = scene.add.rectangle(x, y, 20, 32, col);
    scene.physics.add.existing(this.sprite);
    this.sprite.setAlpha(0.75);

    this.label = scene.add.text(x, y - 26, VR.ROLES[roleId].emoji, {
      fontSize: '14px',
    }).setOrigin(0.5).setAlpha(0.8);

    /* AI state */
    this._target    = null;  // x position being navigated to
    this._cooldown  = 0;
    this._state     = 'wander';
  }

  update(dt, player, cashList, bankGroup) {
    this._cooldown -= dt;

    switch (this._state) {
      case 'wander':    this._doWander(dt, cashList, bankGroup, player); break;
      case 'getCash':   this._doGetCash(dt, cashList); break;
      case 'deposit':   this._doDeposit(dt, bankGroup); break;
      case 'intercept': this._doIntercept(dt, player); break;
    }

    this.sprite.body.setVelocityX(0);

    /* Move toward target */
    if (this._target !== null) {
      const dx = this._target - this.sprite.x;
      if (Math.abs(dx) < 5) {
        this._target = null;
      } else {
        this.sprite.x += Math.sign(dx) * this.speed * dt;
      }
    }

    /* Clamp to world */
    this.sprite.x = Utils.clamp(this.sprite.x, 20, VR.WORLD_W - 20);
    this.label.setPosition(this.sprite.x, this.sprite.y - 26);
  }

  _doWander(dt, cashList, bankGroup, player) {
    if (this._cooldown > 0) return;
    this._cooldown = 1 + Math.random() * 2;

    if (this.roleId === 'thief') {
      /* Look for a nearby worker with carry */
      const dist = Phaser.Math.Distance.Between(
        this.sprite.x, this.sprite.y, player.sprite.x, player.sprite.y
      );
      if (dist < 600 * this.skill && player.carry > 50) {
        this._state = 'intercept';
        return;
      }
      this._target = Utils.randInt(100, VR.WORLD_W - 100);
    } else {
      if (this.carry >= this.carryLimit * 0.8) {
        this._state = 'deposit';
      } else {
        this._state = 'getCash';
      }
    }
  }

  _doGetCash(dt, cashList) {
    const coins = cashList.filter(c => !c.collected);
    if (!coins.length) { this._state = 'wander'; return; }

    /* Nearest coin */
    let best = null, bestD = Infinity;
    for (const c of coins) {
      const d = Math.abs(c.sprite.x - this.sprite.x);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) { this._state = 'wander'; return; }

    this._target = best.sprite.x;

    /* Collect on arrival */
    if (bestD < 20) {
      const val = best.collect();
      this.carry += Math.min(val, this.carryLimit - this.carry);
      this.scene.time.delayedCall(VR.CASH.RESPAWN_DELAY, () => {
        if (this.scene.sys && this.scene.sys.isActive()) best.respawn();
      });
      if (this.carry >= this.carryLimit * 0.8) this._state = 'deposit';
    }
  }

  _doDeposit(dt, bankGroup) {
    const open = bankGroup.filter(b => b.open);
    if (!open.length) { this._state = 'wander'; return; }

    /* Nearest open bank */
    let bank = open.reduce((a, b) =>
      Math.abs(a.x - this.sprite.x) < Math.abs(b.x - this.sprite.x) ? a : b
    );

    this._target = bank.x;

    if (Math.abs(this.sprite.x - bank.x) < 30 && this.carry > 0) {
      bank.deposit(this.carry);
      this.carry = 0;
      this._state = 'wander';
    }
  }

  _doIntercept(dt, player) {
    this._target = player.sprite.x;

    const dist = Phaser.Math.Distance.Between(
      this.sprite.x, this.sprite.y, player.sprite.x, player.sprite.y
    );

    if (dist < VR.ROBBERY.RANGE && player.carry > 0) {
      /* Rob the player */
      const vest   = Store.owns('vest') && player.roleId !== 'thief';
      const stolen = vest ? Math.floor(player.carry * 0.6) : player.carry;
      player.carry -= stolen;
      this.carry   += stolen;
      Utils.toast(`🦹 CPU thief robbed you! -${Utils.dollars(stolen)}`, 'bad');
      this._state = 'deposit';
    }

    /* Give up if player moves far away */
    if (dist > 800) this._state = 'wander';
  }
}
