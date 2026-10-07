/* ══════════════════════════════════════════════════════════
   main.js — Phaser bootstrap
   Menus/store/result are plain HTML (see js/ui.js).
   Phaser only handles the live game canvas.
══════════════════════════════════════════════════════════ */

window.game = new Phaser.Game({
  type:   Phaser.AUTO,
  width:  VR.CANVAS_W,
  height: VR.CANVAS_H,
  parent: 'game-container',
  backgroundColor: '#1a1a2e',
  physics: {
    default: 'arcade',
    arcade:  { gravity: { y: 0 }, debug: false },
  },
  scene: [
    BootScene,
    GameScene,
  ],
});
