/* ══════════════════════════════════════════════════════════
   Player — the human-controlled character
══════════════════════════════════════════════════════════ */

class Player {
  constructor(scene, x, y, roleId, stats) {
    this.scene     = scene;
    this.roleId    = roleId;
    this.speed     = stats.speed;
    this.carryLimit = stats.carryLimit;
    this.carry     = 0;

    const roleCfg = VR.ROLES[roleId];

    /* Main sprite (rectangle stand-in — replace with sprite sheet for art) */
    this.sprite = scene.add.rectangle(x, y, 22, 36, roleCfg.color);
    scene.physics.add.existing(this.sprite, false);
    this.sprite.body.setCollideWorldBounds(true);
    this.sprite.body.setMaxVelocityX(this.speed);

    /* Role emoji label above player */
    this.label = scene.add.text(x, y - 28, roleCfg.emoji, {
      fontSize: '18px',
    }).setOrigin(0.5, 1);

    /* Carry bar above player */
    this.carryBarBg = scene.add.rectangle(x, y - 42, 28, 5, 0x333333);
    this.carryBar   = scene.add.rectangle(x, y - 42, 28, 5, VR.COLORS.green);
    this.carryBar.setOrigin(0, 0.5);

    this._disguised = false;
  }

  update(cursors, wasd, touch) {
    const sp = this.sprite;
    const vx = this.speed;

    const goLeft  = cursors.left.isDown  || wasd.A.isDown || touch.left;
    const goRight = cursors.right.isDown || wasd.D.isDown || touch.right;

    if (goLeft) {
      sp.body.setVelocityX(-vx);
    } else if (goRight) {
      sp.body.setVelocityX(vx);
    } else {
      sp.body.setVelocityX(0);
    }

    /* Follow sprite with overlays */
    const lx = sp.x, ly = sp.y;
    this.label.setPosition(lx, ly - 28);

    const frac = this.carryLimit > 0 ? this.carry / this.carryLimit : 0;
    this.carryBarBg.setPosition(lx, ly - 44);
    this.carryBar.setPosition(lx - 14, ly - 44);
    this.carryBar.setSize(28 * frac, 5);

    /* Colour bar red when full */
    this.carryBar.setFillStyle(frac >= 0.9 ? VR.COLORS.red : VR.COLORS.green);

    /* Disguise: dim the sprite */
    if (this._disguised) sp.setFillStyle(0x888888);
  }

  setDisguise(on) {
    this._disguised = on;
    if (!on) this.sprite.setFillStyle(VR.ROLES[this.roleId].color);
  }
}
