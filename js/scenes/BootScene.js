/* BootScene — just starts GameScene idle state.
   All menus are plain HTML (see js/ui.js).        */

class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }
  create() {
    /* Show the HTML menu after Phaser is ready */
    UI.showMenu();
  }
}
