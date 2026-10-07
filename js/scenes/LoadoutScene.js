/* ══════════════════════════════════════════════════════════
   LoadoutScene — pick role, difficulty, then start game
══════════════════════════════════════════════════════════ */

class LoadoutScene extends Phaser.Scene {
  constructor() { super('LoadoutScene'); }

  create() {
    this.cameras.main.setBackgroundColor(VR.COLORS.sky);

    this._role = 'banker';
    this._diff = 'medium';

    this.div = this.add.dom(VR.CANVAS_W / 2, VR.CANVAS_H / 2).createFromHTML(this._html());
    this.div.setOrigin(0.5);
    this._bind();
    this._refreshSelected();
  }

  _html() {
    const roles = Object.entries(VR.ROLES).map(([id, r]) => `
      <div class="role-card" data-role="${id}">
        <div class="role-emoji">${r.emoji}</div>
        <div class="role-name">${r.label.replace(/^[^ ]+ /,'')}</div>
        <div class="role-desc">${r.description}</div>
      </div>`).join('');

    const diffs = Object.entries(VR.DIFFICULTY).map(([id, d]) => `
      <button class="diff-btn" data-diff="${id}">${d.label}</button>`).join('');

    return `
    <div class="vr-screen" style="background:transparent;gap:14px;">
      <div class="vr-title" style="font-size:30px;">Choose Your Role</div>
      <div class="role-cards">${roles}</div>
      <div style="font-size:13px;color:var(--text-dim);">Difficulty</div>
      <div class="diff-row">${diffs}</div>
      <div style="display:flex;gap:10px;margin-top:6px;">
        <button class="vr-btn" id="btn-start">🏃 Start Round</button>
        <button class="vr-btn secondary" id="btn-back">← Back</button>
      </div>
    </div>`;
  }

  _bind() {
    this.div.addListener('click');
    this.div.on('click', e => {
      const rc = e.target.closest('[data-role]');
      if (rc) { this._role = rc.dataset.role; this._refreshSelected(); return; }

      const dc = e.target.closest('[data-diff]');
      if (dc) { this._diff = dc.dataset.diff; this._refreshSelected(); return; }

      if (e.target.id === 'btn-start') {
        this.scene.start('GameScene', { role: this._role, difficulty: this._diff });
      }
      if (e.target.id === 'btn-back') this.scene.start('MenuScene');
    });
  }

  _refreshSelected() {
    this.div.node.querySelectorAll('.role-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.role === this._role);
    });
    this.div.node.querySelectorAll('.diff-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.diff === this._diff);
    });
  }
}
