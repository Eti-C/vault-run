/* ════════════════════════════════════════════════════════════════
   GameScene — the main playing field
   ─────────────────────────────────────────────────────────────
   Manages:
     • Scrolling city world (procedural graphics)
     • Player movement
     • Cash pickups (spawn, collect, respawn)
     • Banks (health, deposit, closure)
     • NPC Cops (patrol, proximity fines)
     • CPU opponents (AI)
     • Robbery mechanic
     • Timer & round end
     • Mini-map rendering
     • HUD updates
════════════════════════════════════════════════════════════════ */

class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  /* ── init receives data from UI.startGame() or mpStartRound() ── */
  init(data) {
    this.roleId      = data.role        || 'banker';
    this.diffId      = data.difficulty  || 'medium';
    this.isMP        = data.multiplayer || false;
    this.roleConf    = VR.ROLES[this.roleId];
    /* In multiplayer, difficulty config falls back to hard-equivalent */
    this.diffConf    = VR.DIFFICULTY[this.diffId] || VR.DIFFICULTY.hard;
    this.fineConf    = VR.FINES[this.diffId]      || VR.FINES.multiplayer;
  }

  create() {
    /* Phaser doesn't call a scene's shutdown() method by itself */
    this.events.once('shutdown', this.shutdown, this);

    /* ── Physics world bounds ── */
    this.physics.world.setBounds(0, 0, VR.WORLD_W, VR.CANVAS_H);

    /* ── Draw city ── */
    this._buildWorld();

    /* ── Camera ── */
    this.cameras.main.setBounds(0, 0, VR.WORLD_W, VR.CANVAS_H);

    /* ── Collections ── */
    this.cashList  = [];   // CashPickup instances
    this.bankGroup = [];
    this.copGroup  = [];
    this.cpuGroup  = [];

    /* ── Spawn objects ── */
    this._spawnBanks();
    this._spawnCash(VR.CASH.SPAWN_COUNT);

    /* Cops & opponents: server-driven in MP, local in solo */
    if (!this.isMP) {
      this._spawnCops();
      this._spawnCPUs();
    }

    /* Attach multiplayer manager to this scene */
    if (this.isMP) MP.attachScene(this);

    /* ── Player ── */
    const stats = Store.applyItems(this.roleId, {
      speed:      this.roleConf.speed,
      carryLimit: this.roleConf.carryLimit,
    });
    this.player = new Player(this, VR.CANVAS_W / 2, VR.GROUND_Y - 22, this.roleId, stats);
    this.cameras.main.startFollow(this.player.sprite, true, 0.08, 0.08);

    /* ── Input ── */
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd    = this.input.keyboard.addKeys('W,A,S,D');
    this.touchInput = { left: false, right: false };
    this._buildTouchControls();
    this.input.keyboard.on('keydown-R', () => this._tryReport());
    this.input.keyboard.on('keydown-T', () => this._tryTipOff());

    /* ── Round state ── */
    this.roundTime       = VR.ROUND_TIME;
    this.sessionEarnings = 0;
    this.isRobbing       = false;
    this.disguiseActive  = false;
    this.disguiseTimer   = 0;
    this.disguiseUsed    = false;
    this.nearCop         = false;
    this.copFineTimer    = 0;
    this.roundOver       = false;

    /* ── HUD ── */
    Utils.showHUD();
    Utils.updateHUD({
      role:    this.roleConf.label,
      carry:   0,
      balance: Store.balance,
      timer:   this.roundTime,
      items:   Store.itemsHUD(this.roleId),
    });

    /* ── MP: send position at 20hz ── */
    this.mpSendTimer = 0;

    /* ── Timer (solo only; MP timer comes from server) ── */
    if (!this.isMP) {
      this.timerEvent = this.time.addEvent({
        delay: 1000,
        repeat: VR.ROUND_TIME - 1,
        callback: this._tickTimer,
        callbackScope: this,
      });
    }

    /* ── Mini-map ── */
    this.minimapCanvas = document.getElementById('minimap');
    this.minimapCtx    = this.minimapCanvas.getContext('2d');
  }

  /* ══════════════════════════════════════════════
     UPDATE LOOP
  ══════════════════════════════════════════════ */
  update(time, delta) {
    if (this.roundOver) return;
    const dt = delta / 1000;

    this.player.update(this.cursors, this.wasd, this.touchInput);

    /* Cash pickup (proximity check) */
    this._checkCashPickup();

    /* Bank deposit */
    if (this.roleId !== 'thief') this._checkDeposit();

    if (this.isMP) {
      /* ── Multiplayer: server drives cops/fines; we send our position ── */
      MP.updateRemotePlayers(dt);

      this.mpSendTimer += dt;
      if (this.mpSendTimer >= 0.05) {  // 20 Hz
        this.mpSendTimer = 0;
        MP.sendMove(this.player.sprite.x, this.player.sprite.y, this.player.carry);
      }

      /* Robbery against remote players (thief only) */
      if (this.roleId === 'thief') this._checkRobberyMP();

      /* Display-only countdown; the server decides when the round ends */
      this.roundTime = Math.max(0, this.roundTime - dt);
      Utils.updateHUD({ timer: this.roundTime });

    } else {
      /* ── Solo: local cops, local CPUs ── */
      this.copGroup.forEach(cop => {
        cop.update(dt);
        this._checkCopProximity(cop, dt);
      });
      this.cpuGroup.forEach(c => c.update(dt, this.player, this.cashList, this.bankGroup));
      if (this.roleId === 'thief') this._checkRobbery(dt);

      /* Bank decay (server handles this in multiplayer) */
      this.bankGroup.forEach(b => b.decay(dt));
    }

    /* Disguise countdown */
    if (this.disguiseActive) {
      this.disguiseTimer -= dt;
      if (this.disguiseTimer <= 0) {
        this.disguiseActive = false;
        this.player.setDisguise(false);
        Utils.toast('Disguise expired', 'warn');
      }
    }

    /* HUD */
    Utils.updateHUD({
      carry:   this.player.carry,
      balance: Store.balance + this.sessionEarnings,
    });

    /* Mini-map */
    this._drawMinimap();
  }

  /* ══════════════════════════════════════════════
     WORLD BUILDING
  ══════════════════════════════════════════════ */
  _buildWorld() {
    const g  = this.add.graphics();
    const W  = VR.WORLD_W;
    const GY = VR.GROUND_Y;

    /* Sky */
    g.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x16213e, 0x16213e, 1)
     .fillRect(0, 0, W, GY);

    /* Zone tints */
    VR.ZONES.forEach(z => {
      const col = z.name === 'industrial' ? 0x1a0a00
                : z.name === 'bankrow'    ? 0x001a0a
                : 0x0d1020;
      g.fillStyle(col, 0.5).fillRect(z.x, 0, z.w, GY);
    });

    /* Buildings */
    this._drawBuildings(g, W, GY);

    /* Ground */
    g.fillStyle(0x2c3e50).fillRect(0, GY, W, VR.CANVAS_H - GY);
    /* Road dashes */
    g.fillStyle(0xffffff, 0.12);
    for (let x = 40; x < W; x += 80) g.fillRect(x, GY + 28, 40, 4);

    /* Alleyways */
    VR.ALLEYWAYS.forEach(a => {
      g.fillStyle(0x050810).fillRect(a.x, 0, a.w, GY);
      this.add.text(a.x + a.w/2, GY - 26, '🌑', { fontSize: '12px' }).setOrigin(0.5);
    });

    /* Zone labels */
    VR.ZONES.forEach(z => {
      this.add.text(z.x + z.w/2, 16, z.label, {
        fontSize: '10px', color: '#a09070',
      }).setOrigin(0.5);
    });
  }

  _drawBuildings(g, W, GY) {
    const palette = [0x1a2a3a, 0x1f2d3d, 0x16252e, 0x0d1f2d, 0x23303d];
    const rng = Phaser.Math.RND;
    let x = 0;
    while (x < W) {
      const bw = rng.between(50, 130);
      const bh = rng.between(60, 200);
      g.fillStyle(palette[rng.between(0, palette.length - 1)]).fillRect(x, GY - bh, bw - 3, bh);
      /* windows */
      g.fillStyle(0xf5c518, rng.frac() > 0.4 ? 0.7 : 0.1);
      for (let wy = GY - bh + 10; wy < GY - 15; wy += 22) {
        for (let wx = x + 8; wx < x + bw - 12; wx += 18) {
          if (rng.frac() > 0.35) g.fillRect(wx, wy, 9, 12);
        }
      }
      x += bw;
    }
  }

  /* ══════════════════════════════════════════════
     CASH SPAWNING
  ══════════════════════════════════════════════ */
  _spawnCash(count) {
    for (let i = 0; i < count; i++) {
      const wx = Utils.randInt(80, VR.WORLD_W - 80);
      if (Utils.inAlley(wx)) { i--; continue; }
      const [mn, mx] = Utils.cashRange(wx);
      const cash = new CashPickup(this, wx, VR.GROUND_Y - 14, Utils.randInt(mn, mx));
      this.cashList.push(cash);
    }
  }

  _checkCashPickup() {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    for (const cash of this.cashList) {
      if (cash.collected) continue;
      const dist = Phaser.Math.Distance.Between(px, py, cash.sprite.x, cash.sprite.y);
      if (dist < 20) {
        const space = this.player.carryLimit - this.player.carry;
        if (space <= 0) {
          if (!this._bagFullWarned) {
            this._bagFullWarned = true;
            Utils.toast('Bag full! Find a bank.', 'warn');
            this.time.delayedCall(3000, () => { this._bagFullWarned = false; });
          }
          return;
        }
        const take = Math.min(cash.value, space);
        this.player.carry += take;
        cash.collect();
        this.time.delayedCall(VR.CASH.RESPAWN_DELAY, () => {
          if (this.scene.isActive('GameScene')) cash.respawn();
        });
      }
    }
  }

  /* ══════════════════════════════════════════════
     BANKS
  ══════════════════════════════════════════════ */
  _spawnBanks() {
    const positions = [200, 900, 1800, 3500, 5400];
    positions.slice(0, VR.BANKS.COUNT).forEach((x, i) => {
      this.bankGroup.push(new Bank(this, x, VR.GROUND_Y, i));
    });
  }

  _checkDeposit() {
    for (const bank of this.bankGroup) {
      if (!bank.open) continue;
      if (Math.abs(this.player.sprite.x - bank.x) < 55 && this.player.carry > 0) {
        this._doDeposit(bank);
        break;
      }
    }
  }

  _doDeposit(bank) {
    const carry = this.player.carry;
    if (this.isMP) {
      /* Server calculates cut and confirms via deposit:confirmed */
      MP.sendDeposit(bank.index, carry);
      bank.deposit(carry);  // optimistic health update
      this.player.carry = 0;
      Utils.toast('Deposited! Waiting for server…', 'good');
    } else {
      let cut = carry * this.roleConf.depositCut * this.diffConf.earnMult;
      if (this.roleId === 'truck' && this.roleConf.flatFee) cut += this.roleConf.flatFee;
      this.sessionEarnings += cut;
      bank.deposit(carry);
      this.player.carry = 0;
      Utils.toast(`Deposited! +${Utils.dollars(cut)}`, 'good');
    }
  }

  /* ══════════════════════════════════════════════
     COPS
  ══════════════════════════════════════════════ */
  _spawnCops() {
    const n = this.diffConf.copCount;
    const speed = this.diffConf.copSpeed;
    for (let i = 0; i < n; i++) {
      const seg = VR.COPS.PATROL_SEGMENTS[i % VR.COPS.PATROL_SEGMENTS.length];
      this.copGroup.push(new Cop(this, seg[0] + (seg[1]-seg[0])/2, VR.GROUND_Y - 20, seg, speed));
    }
  }

  _checkCopProximity(cop, dt) {
    if (this.roleId !== 'thief') return;
    const dist = Phaser.Math.Distance.Between(
      this.player.sprite.x, this.player.sprite.y,
      cop.sprite.x, cop.sprite.y
    );
    if (dist < VR.COPS.PROXIMITY_RANGE) {
      if (!this.nearCop) {
        const fineAmt = Math.max(10, (Store.balance + this.sessionEarnings) * this.fineConf.initial);
        this.sessionEarnings -= fineAmt;
        Utils.toast(`🚔 COP! Fine: -${Utils.dollars(fineAmt)}`, 'bad');
        this.nearCop = true;
        this.cameras.main.flash(300, 200, 0, 0);
      } else {
        this.copFineTimer += dt;
        if (this.copFineTimer >= 1) {
          this.copFineTimer = 0;
          const fineAmt = Math.max(2, (Store.balance + this.sessionEarnings) * this.fineConf.perSec);
          this.sessionEarnings -= fineAmt;
          Utils.toast(`🚔 Fine: -${Utils.dollars(fineAmt)}/sec`, 'bad');
        }
      }
    } else {
      this.nearCop = false;
      this.copFineTimer = 0;
    }
  }

  /* ══════════════════════════════════════════════
     ROBBERY (thief only)
  ══════════════════════════════════════════════ */
  _checkRobbery(dt) {
    if (this.isRobbing) return;
    for (const cpu of this.cpuGroup) {
      if (cpu.roleId !== 'truck' && cpu.roleId !== 'banker') continue;
      const dist = Phaser.Math.Distance.Between(
        this.player.sprite.x, this.player.sprite.y,
        cpu.sprite.x, cpu.sprite.y
      );
      if (dist < VR.ROBBERY.RANGE && cpu.carry > 0) {
        this._startRobbery(cpu);
        return;
      }
    }
  }

  _startRobbery(victim) {
    this.isRobbing = true;
    let take = victim.hasVest ? victim.carry * 0.6 : victim.carry;
    victim.carry = 0;
    this.player.carry += take;
    this.sessionEarnings += take;
    Utils.toast(`🦹 Robbed! +${Utils.dollars(take)}`, 'good');

    if (victim.hasPhone) {
      const frac = Utils.randFloat(VR.ROBBERY.PHONE_FINE_MIN, VR.ROBBERY.PHONE_FINE_MAX);
      const fine = take * frac;
      this.sessionEarnings -= fine;
      Utils.toast(`📱 Reported! Fine: -${Utils.dollars(fine)}`, 'bad');
    }

    if (Store.owns('disguise') && !this.disguiseUsed) {
      this.disguiseActive = true;
      this.disguiseTimer  = 30;
      this.disguiseUsed   = true;
      this.player.setDisguise(true);
      Utils.toast('🕶️ Disguise active (30s)', 'warn');
    }

    this.time.delayedCall(VR.ROBBERY.DURATION, () => { this.isRobbing = false; });
  }

  /* ══════════════════════════════════════════════
     REPORTING & TIP-OFFS
  ══════════════════════════════════════════════ */
  _tryReport() {
    if (this.roleId === 'thief') return;
    if (!Store.owns('phone')) { Utils.toast('Need 📱 to report!', 'warn'); return; }
    if (this.isMP) {
      /* Find nearest thief remote player and report them */
      const thieves = MP.getRemotePlayers().filter(p => p.role === 'thief');
      const nearest = thieves.sort((a,b) =>
        Math.abs(a.x - this.player.sprite.x) - Math.abs(b.x - this.player.sprite.x))[0];
      if (nearest && Math.abs(nearest.x - this.player.sprite.x) < 300) {
        MP.sendReport(nearest.socketId);
      } else {
        Utils.toast('No thief in range.', 'warn');
      }
    } else {
      const thief = this.cpuGroup.find(c => c.roleId === 'thief');
      if (!thief) return;
      const dist = Phaser.Math.Distance.Between(
        this.player.sprite.x, this.player.sprite.y, thief.sprite.x, thief.sprite.y
      );
      if (dist < 300) {
        const fine = thief.carry * Utils.randFloat(0.3, 0.8);
        thief.carry -= fine;
        Utils.toast('📱 Thief reported! Fine issued.', 'good');
      } else {
        Utils.toast('Too far — thief out of range.', 'warn');
      }
    }
  }

  _tryTipOff() {
    if (this.roleId === 'thief') return;
    if (!Store.owns('phone')) { Utils.toast('Need 📱 for tip-offs!', 'warn'); return; }
    if (this.isMP) {
      MP.sendTipOff();
    } else {
      this.copGroup.forEach(cop => {
        Utils.toast(`🚔 Cop in ${Utils.zoneAt(cop.sprite.x)}`, 'warn', 4000);
      });
    }
  }

  /* ══════════════════════════════════════════════
     MULTIPLAYER ROBBERY (against real players)
  ══════════════════════════════════════════════ */
  _checkRobberyMP() {
    if (this.isRobbing) return;
    for (const rp of MP.getRemotePlayers()) {
      if (rp.role !== 'truck' && rp.role !== 'banker') continue;
      const dist = Phaser.Math.Distance.Between(
        this.player.sprite.x, this.player.sprite.y, rp.x, rp.y
      );
      if (dist < VR.ROBBERY.RANGE && rp.carry > 0) {
        this.isRobbing = true;
        MP.attemptRobbery(rp.socketId);
        this.time.delayedCall(VR.ROBBERY.DURATION, () => { this.isRobbing = false; });
        return;
      }
    }
  }

  /* ══════════════════════════════════════════════
     SERVER EVENT HANDLERS (multiplayer only)
     Called by MP module when server sends events.
  ══════════════════════════════════════════════ */

  /* Server pushed authoritative cop positions */
  onCopsUpdate(cops) {
    /* Create cop sprites if not yet present */
    while (this.copGroup.length < cops.length) {
      const seg = VR.COPS.PATROL_SEGMENTS[this.copGroup.length % VR.COPS.PATROL_SEGMENTS.length];
      this.copGroup.push(new Cop(this, 0, VR.GROUND_Y - 20, seg, 0));
    }
    cops.forEach((c, i) => {
      const cop = this.copGroup[i];
      if (!cop) return;
      cop.sprite.setPosition(c.x, cop.sprite.y);
      cop.label.setPosition(c.x, cop.sprite.y - 26);
    });
  }

  /* Server pushed bank health */
  onBanksUpdate(banks) {
    banks.forEach(b => {
      const bank = this.bankGroup[b.id];
      if (!bank) return;
      if (!b.open) { this.onBankClosed(b.id); return; }
      bank.health = b.health;
      bank._updateBar();
    });
  }

  onBankClosed(bankId) {
    const bank = this.bankGroup[bankId];
    if (bank && bank.open) bank._close();
  }

  /* Server fined this player (thief) */
  onCopFine(amount, type) {
    this.sessionEarnings -= amount;
    if (type === 'initial') this.cameras.main.flash(300, 200, 0, 0);
  }

  onRobberySuccess(take) {
    this.player.carry += take;
    this.sessionEarnings += take;
    if (Store.owns('disguise') && !this.disguiseUsed) {
      this.disguiseActive = true;
      this.disguiseTimer  = 30;
      this.disguiseUsed   = true;
      this.player.setDisguise(true);
      Utils.toast('🕶️ Disguise active (30s)', 'warn');
    }
  }

  onRobberyVictim(lost) {
    this.player.carry = Math.max(0, this.player.carry - lost);
  }

  onReportedFine(amount) {
    this.sessionEarnings -= amount;
  }

  onDepositConfirmed(cut) {
    this.sessionEarnings += cut;
    Utils.toast(`Deposited! +${Utils.dollars(cut)}`, 'good');
  }

  onServerRoundStart(data) {
    /* Server confirms round has started — reset timer display */
    this.roundTime = data.roundTime || VR.ROUND_TIME;
  }

  /* Server ended the round */
  onRoundEnd(data) {
    if (this.roundOver) return;
    this.roundOver = true;
    if (this.timerEvent) this.timerEvent.remove();
    Store.addEarnings(data.earned);

    this.time.delayedCall(1800, () => {
      this.scene.stop('GameScene');
      UI.showResult({
        role:       this.roleId,
        difficulty: this.diffId,
        earned:     data.earned,
        /* earned already includes the ×1.25 bonus */
        bonus:      data.allOpen && this.roleId !== 'thief' ? data.earned - Math.floor(data.earned / 1.25) : 0,
        balance:    Store.balance,
        allOpen:    data.allOpen,
        mult:       data.mult,
      });
    });
  }

  /* ══════════════════════════════════════════════
     CPU OPPONENTS
  ══════════════════════════════════════════════ */
  _spawnCPUs() {
    const roles = ['banker', 'truck', 'thief'];
    for (let i = 0; i < VR.CPU_COUNT; i++) {
      const x = Utils.randInt(200, VR.WORLD_W - 200);
      const cpu = new CPU(this, x, VR.GROUND_Y - 20, roles[i % roles.length], this.diffConf.cpuSkill);
      this.cpuGroup.push(cpu);
    }
  }

  /* ══════════════════════════════════════════════
     TIMER & ROUND END
  ══════════════════════════════════════════════ */
  _tickTimer() {
    this.roundTime--;
    Utils.updateHUD({ timer: this.roundTime });
    if (this.roundTime <= 0) this._endRound();
  }

  _endRound() {
    if (this.roundOver) return;
    this.roundOver = true;
    this.timerEvent.remove();

    const allOpen = this.bankGroup.every(b => b.open);
    let bonus = 0;
    if (allOpen && this.roleId !== 'thief') {
      bonus = this.sessionEarnings * 0.25;
      this.sessionEarnings += bonus;
      Utils.toast('🏆 All banks open! +25% bonus!', 'good');
    }

    const net = Math.max(0, Math.floor(this.sessionEarnings));
    Store.addEarnings(net);

    this.time.delayedCall(1800, () => {
      this.scene.stop('GameScene');
      UI.showResult({
        role:       this.roleId,
        difficulty: this.diffId,
        earned:     net,
        bonus:      bonus,
        balance:    Store.balance,
        allOpen:    allOpen,
      });
    });
  }

  /* ── Clean up when scene stops ── */
  shutdown() {
    if (this.isMP) MP.detachScene();
    if (this.timerEvent) this.timerEvent.remove();
  }

  /* ══════════════════════════════════════════════
     MINI-MAP
  ══════════════════════════════════════════════ */
  _drawMinimap() {
    const ctx   = this.minimapCtx;
    const cw = 200, ch = 60;
    const scale = cw / VR.WORLD_W;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, cw, ch);

    VR.ZONES.forEach(z => {
      ctx.fillStyle = z.name === 'industrial' ? 'rgba(180,60,0,0.3)'
                    : z.name === 'bankrow'    ? 'rgba(0,120,60,0.3)'
                    : 'rgba(30,60,120,0.2)';
      ctx.fillRect(z.x * scale, 0, z.w * scale, ch);
    });

    /* Banks */
    this.bankGroup.forEach(b => {
      ctx.fillStyle = b.open ? '#2ecc71' : '#555';
      ctx.fillRect(b.x * scale - 2, ch/2 - 5, 4, 10);
    });

    /* Cash dots */
    this.cashList.forEach(c => {
      if (c.collected) return;
      ctx.fillStyle = '#f5c518';
      ctx.fillRect(c.sprite.x * scale - 1, ch * 0.65, 2, 2);
    });

    /* Cops — range gated for thieves */
    const mapRange = (Store.owns('minimap') ? 1000 : 0) + (Store.owns('scanner') ? 800 : 400);
    this.copGroup.forEach(cop => {
      const dist = Math.abs(this.player.sprite.x - cop.sprite.x);
      if (this.roleId !== 'thief' || dist < mapRange) {
        ctx.fillStyle = '#3498db';
        ctx.beginPath();
        ctx.arc(cop.sprite.x * scale, ch/2, 3, 0, Math.PI*2);
        ctx.fill();
      }
    });

    /* CPU dots */
    this.cpuGroup.forEach(cpu => {
      ctx.fillStyle = cpu.roleId === 'thief' ? '#e74c3c' : '#95a5a6';
      ctx.fillRect(cpu.sprite.x * scale - 2, ch/2 - 2, 4, 4);
    });

    /* Player */
    ctx.fillStyle = '#f5c518';
    ctx.beginPath();
    ctx.arc(this.player.sprite.x * scale, ch/2, 4, 0, Math.PI*2);
    ctx.fill();

    /* Camera viewport */
    const camX = this.cameras.main.scrollX;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(camX * scale, 2, VR.CANVAS_W * scale, ch - 4);
  }

  /* ══════════════════════════════════════════════
     TOUCH CONTROLS (on-screen arrows)
  ══════════════════════════════════════════════ */
  _buildTouchControls() {
    const style = {
      fontSize: '22px',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.35)',
      padding: { x: 16, y: 8 },
    };
    const L = this.add.text(55, VR.CANVAS_H - 38, '◀', style)
      .setScrollFactor(0).setInteractive().setDepth(50);
    const R = this.add.text(110, VR.CANVAS_H - 38, '▶', style)
      .setScrollFactor(0).setInteractive().setDepth(50);

    L.on('pointerdown', () => this.touchInput.left  = true);
    L.on('pointerup',   () => this.touchInput.left  = false);
    L.on('pointerout',  () => this.touchInput.left  = false);
    R.on('pointerdown', () => this.touchInput.right = true);
    R.on('pointerup',   () => this.touchInput.right = false);
    R.on('pointerout',  () => this.touchInput.right = false);
  }
}
