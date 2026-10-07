/* ══════════════════════════════════════════════════════════
   Cop — NPC patrol officer
   Walks left/right between patrol segment bounds.
   Never enters alleyways.
   Proximity fines are calculated in GameScene.
══════════════════════════════════════════════════════════ */

class Cop {
  constructor(scene, x, y, segment, speed) {
    this.scene   = scene;
    this.segment = segment;   // [leftX, rightX]
    this.speed   = speed;
    this.dir     = 1;         // 1 = right, -1 = left

    /* Cop sprite (blue rectangle) */
    this.sprite = scene.add.rectangle(x, y, 20, 34, VR.COLORS.cop);
    scene.physics.add.existing(this.sprite, true); // true = static body

    /* Label */
    this.label = scene.add.text(x, y - 26, '🚔', { fontSize: '16px' }).setOrigin(0.5);
  }

  update(dt) {
    const sp = this.sprite;

    /* Move in current direction */
    sp.x += this.speed * this.dir * dt;

    /* Turn at bounds */
    if (sp.x >= this.segment[1]) { sp.x = this.segment[1]; this.dir = -1; }
    if (sp.x <= this.segment[0]) { sp.x = this.segment[0]; this.dir =  1; }

    /* Skip over alleyways */
    if (Utils.inAlley(sp.x)) {
      sp.x += this.speed * this.dir * dt * 3; // hop through quickly
    }

    this.label.setPosition(sp.x, sp.y - 26);
  }
}
