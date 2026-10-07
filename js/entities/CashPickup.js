/* ══════════════════════════════════════════════════════════
   CashPickup — a collectable $VR coin on the street
══════════════════════════════════════════════════════════ */

class CashPickup {
  constructor(scene, x, y, value) {
    this.scene     = scene;
    this.value     = value;
    this.collected = false;

    /* Coin — plain Rectangle with physics body */
    this.sprite = scene.add.rectangle(x, y, 16, 16, VR.COLORS.cash);
    scene.physics.add.existing(this.sprite, true); // static body
    this.sprite.setData('entity', this);

    /* Value label */
    this.label = scene.add.text(x, y - 14, '$' + value, {
      fontSize: '9px', color: '#f5c518',
    }).setOrigin(0.5);
  }

  collect() {
    if (this.collected) return 0;
    this.collected = true;
    this.sprite.setActive(false).setVisible(false);
    this.label.setVisible(false);
    this.sprite.body.enable = false;
    return this.value;
  }

  respawn() {
    this.collected = false;
    const wx = Utils.randInt(80, VR.WORLD_W - 80);
    const [min, max] = Utils.cashRange(wx);
    this.value = Utils.randInt(min, max);

    this.sprite.setPosition(wx, VR.GROUND_Y - 14);
    this.label.setPosition(wx, VR.GROUND_Y - 28).setText('$' + this.value);
    this.sprite.setActive(true).setVisible(true);
    this.label.setVisible(true);
    this.sprite.body.reset(wx, VR.GROUND_Y - 14);
    this.sprite.body.enable = true;
  }
}
