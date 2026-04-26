import { io } from 'socket.io-client';
import {
  BOOST,
  MOVE_SET,
  createMatchState,
  resolveAction,
  applyBoostDash,
  applyBoostStep,
  applyVerticalThrust,
  tickMatch,
  createInputBuffer,
  interpolateSnapshot,
  getDistance3D
} from '@gvg/shared/src/gameLogic.js';

export class FightScene extends Phaser.Scene {
  constructor() {
    super('Fight');
  }

  init(data) {
    this.playerCharacter = data.playerCharacter;
    this.enemyCharacter = data.enemyCharacter;
    this.mode = data.mode || 'bot';
  }

  create() {
    this.match = createMatchState();
    this.match.fighters.p1.characterId = this.playerCharacter.id;
    this.match.fighters.p2.characterId = this.enemyCharacter.id;

    this.createDigitalVoid();
    this.rigs = {
      p1: this.createWireRig(this.match.fighters.p1, this.playerCharacter.color),
      p2: this.createWireRig(this.match.fighters.p2, this.enemyCharacter.color)
    };

    this.projectileLayer = this.add.layer();
    this.ghostLayer = this.add.layer();

    this.ui = this.createHud();
    this.inputBuffer = createInputBuffer(10);
    this.touch = this.createTouchControls();

    this.socket = null;
    this.interpolationBuffer = [];
    if (this.mode === 'online') this.setupSocket();

    this.time.addEvent({ delay: 380, loop: true, callback: () => this.botThink() });
  }

  setupSocket() {
    this.socket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:3001');
    this.socket.on('match:snapshot', (snapshot) => {
      this.interpolationBuffer.push(snapshot);
      if (this.interpolationBuffer.length > 6) this.interpolationBuffer.shift();
    });
  }

  createDigitalVoid() {
    this.add.rectangle(640, 360, 1280, 720, 0x03050c);

    const aura = this.add.graphics();
    aura.fillStyle(0x53e7ff, 0.08);
    aura.fillEllipse(340, 380, 460, 220);
    aura.fillStyle(0xff4fcf, 0.08);
    aura.fillEllipse(940, 320, 500, 220);

    const horizon = this.add.graphics({ lineStyle: { width: 2, color: 0x4de5ff, alpha: 0.22 } });
    for (let i = 0; i < 6; i += 1) {
      horizon.lineBetween(80 + i * 200, 560 - i * 18, 1200 - i * 120, 560 - i * 18);
    }
  }

  createWireRig(fighter, color) {
    const container = this.add.container(fighter.x, this.toScreenY(fighter.y, fighter.z));
    const gfx = this.add.graphics({ lineStyle: { width: 3, color, alpha: 0.96 } });

    gfx.strokeCircle(0, -62, 18);
    gfx.strokeRoundedRect(-22, -38, 44, 74, 5);
    gfx.strokeTriangle(-34, -18, -56, 10, -22, 8);
    gfx.strokeTriangle(34, -18, 56, 10, 22, 8);
    gfx.strokeRect(-30, 35, 22, 11);
    gfx.strokeRect(8, 35, 22, 11);
    gfx.lineStyle(1, color, 0.34);
    gfx.strokeCircle(0, -62, 24);

    container.add(gfx);
    return container;
  }

  createHud() {
    const p1Hp = this.add.rectangle(44, 42, 280, 16, 0x2befff).setOrigin(0, 0.5).setScrollFactor(0);
    const p2Hp = this.add.rectangle(956, 42, 280, 16, 0xff53d5).setOrigin(0, 0.5).setScrollFactor(0);
    const boostBar = this.add.rectangle(44, 66, 280, 12, 0x8fff62).setOrigin(0, 0.5).setScrollFactor(0);
    return {
      p1Hp,
      p2Hp,
      boostBar,
      status: this.add.text(528, 28, 'LOCK-ON ENGAGED', { fontSize: '20px', color: '#f4ffff' }).setScrollFactor(0),
      detail: this.add.text(506, 54, '', { fontSize: '14px', color: '#93f9ff' }).setScrollFactor(0)
    };
  }

  createTouchControls() {
    const joystickBase = this.add.circle(116, 608, 80, 0x1c2430, 0.45).setScrollFactor(0).setDepth(1000);
    const joystickThumb = this.add.circle(116, 608, 34, 0x6ff5ff, 0.75).setScrollFactor(0).setDepth(1001);

    const buttons = {
      boost: this.makeButton(1036, 640, 'BOOST'),
      shoot: this.makeButton(1160, 600, 'SHOOT'),
      melee: this.makeButton(938, 678, 'MELEE'),
      step: this.makeButton(1160, 694, 'STEP'),
      rise: this.makeButton(1036, 540, 'RISE'),
      drop: this.makeButton(1160, 510, 'DROP')
    };

    const state = { x: 0, z: 0, isDashGesture: false, pointer: null, lastTap: 0, boosting: false };

    joystickBase.setInteractive();
    joystickBase.on('pointerdown', (pointer) => {
      if (state.pointer && state.pointer.id !== pointer.id) return;
      state.isDashGesture = pointer.downTime - state.lastTap < 200;
      state.lastTap = pointer.downTime;
      state.pointer = pointer;
      this.updateJoystick(state, joystickBase, joystickThumb, pointer);
    });

    this.input.on('pointermove', (pointer) => {
      if (!state.pointer || pointer.id !== state.pointer.id) return;
      this.updateJoystick(state, joystickBase, joystickThumb, pointer);
    });

    this.input.on('pointerup', (pointer) => {
      if (!state.pointer || pointer.id !== state.pointer.id) return;
      state.pointer = null;
      state.x = 0;
      state.z = 0;
      state.isDashGesture = false;
      joystickThumb.x = joystickBase.x;
      joystickThumb.y = joystickBase.y;
    });

    buttons.boost.on('pointerdown', () => {
      state.boosting = true;
      this.inputBuffer.push({ type: 'BOOST_DASH' });
    });
    buttons.boost.on('pointerup', () => {
      state.boosting = false;
    });
    buttons.shoot.on('pointerdown', () => this.inputBuffer.push({ type: 'SHOOT' }));
    buttons.melee.on('pointerdown', () => this.inputBuffer.push({ type: 'MELEE' }));
    buttons.step.on('pointerdown', () => this.inputBuffer.push({ type: 'BOOST_STEP' }));
    buttons.rise.on('pointerdown', () => this.inputBuffer.push({ type: 'VERTICAL_THRUST', vertical: 1 }));
    buttons.drop.on('pointerdown', () => this.inputBuffer.push({ type: 'VERTICAL_THRUST', vertical: -1 }));

    return { state };
  }

  makeButton(x, y, label) {
    const button = this.add.circle(x, y, 48, 0x99efff, 0.2).setDepth(1000).setScrollFactor(0).setInteractive();
    this.add.text(x - 23, y - 7, label, { fontSize: '13px', color: '#d9f9ff' }).setDepth(1001).setScrollFactor(0);
    return button;
  }

  updateJoystick(state, base, thumb, pointer) {
    const dx = pointer.x - base.x;
    const dy = pointer.y - base.y;
    const length = Math.min(58, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    thumb.x = base.x + Math.cos(angle) * length;
    thumb.y = base.y + Math.sin(angle) * length;
    state.x = Math.cos(angle) * (length / 58);
    state.z = Math.sin(angle) * (length / 58);
  }

  get player() {
    return this.match.fighters.p1;
  }

  get enemy() {
    return this.match.fighters.p2;
  }

  update() {
    if (this.player.isKO || this.enemy.isKO) {
      const winner = this.player.isKO ? this.enemyCharacter : this.playerCharacter;
      this.scene.start('Result', { winner, playerCharacter: this.playerCharacter, enemyCharacter: this.enemyCharacter });
      return;
    }

    this.handleBufferedInputs();
    this.handleMovement();

    if (this.mode !== 'online') tickMatch(this.match, Date.now());
    this.applySnapshotInterpolation();

    this.updateCameraLock();
    this.renderFighters();
    this.renderProjectiles();
    this.renderGhosting();
    this.updateHud();
  }

  handleMovement() {
    const move = this.touch.state;
    if (Math.hypot(move.x, move.z) > 0.1 && !this.player.isOverheated) {
      this.player.vx = move.x * BOOST.cruiseSpeed;
      this.player.vz = move.z * BOOST.cruiseSpeed;
      this.player.facing = move.x >= 0 ? 1 : -1;
      if (move.isDashGesture || move.boosting) this.tryDash(move);
    }
  }

  handleBufferedInputs() {
    const now = Date.now();
    const move = this.touch.state;
    const inputs = this.inputBuffer.flush();

    for (const input of inputs) {
      if (input.type === 'BOOST_DASH') {
        this.tryDash(move);
        continue;
      }

      if (input.type === 'BOOST_STEP') {
        const stepped = applyBoostStep(this.player, move, now);
        if (stepped) this.spawnStepPulse(this.player);
        this.socket?.emit('input:action', { type: 'BOOST_STEP', move });
        continue;
      }

      if (input.type === 'VERTICAL_THRUST') {
        applyVerticalThrust(this.player, input.vertical, now);
        this.socket?.emit('input:action', { type: 'VERTICAL_THRUST', vertical: input.vertical });
        continue;
      }

      const result = resolveAction(this.player, this.enemy, input.type, now, this.match.projectiles);
      this.socket?.emit('input:action', { type: input.type });
      if (result.heavy && result.applied) this.cameras.main.shake(90, 0.008);
    }
  }

  tryDash(move) {
    const dashed = applyBoostDash(this.player, move, Date.now());
    if (dashed) {
      this.socket?.emit('input:action', { type: 'BOOST_DASH', move });
      this.spawnDashTrail(this.player);
    }
  }

  applySnapshotInterpolation() {
    if (this.mode !== 'online' || this.interpolationBuffer.length < 2) return;
    const prev = this.interpolationBuffer[this.interpolationBuffer.length - 2];
    const next = this.interpolationBuffer[this.interpolationBuffer.length - 1];
    const smooth = interpolateSnapshot(prev, next, 0.5);
    if (!smooth) return;

    this.match.fighters.p2 = { ...this.match.fighters.p2, ...smooth.fighters.p2 };
    this.match.projectiles = smooth.projectiles ?? this.match.projectiles;
  }

  updateCameraLock() {
    const midX = (this.rigs.p1.x + this.rigs.p2.x) / 2;
    const midY = (this.rigs.p1.y + this.rigs.p2.y) / 2;
    const distance = Phaser.Math.Distance.Between(this.rigs.p1.x, this.rigs.p1.y, this.rigs.p2.x, this.rigs.p2.y);
    const zoom = Phaser.Math.Clamp(1.35 - distance / 900, 0.8, 1.45);
    this.cameras.main.centerOn(midX, midY);
    this.cameras.main.setZoom(zoom);
  }

  renderFighters() {
    this.rigs.p1.x = this.player.x;
    this.rigs.p1.y = this.toScreenY(this.player.y, this.player.z);
    this.rigs.p2.x = this.enemy.x;
    this.rigs.p2.y = this.toScreenY(this.enemy.y, this.enemy.z);
  }

  renderProjectiles() {
    this.projectileLayer.removeAll(true);
    for (const projectile of this.match.projectiles) {
      const y = this.toScreenY(projectile.y, projectile.z);
      const orb = this.add.circle(projectile.x, y, 6, projectile.ownerId === 'p1' ? 0x7efbff : 0xff7de1, 0.88);
      const trail = this.add.circle(projectile.x - projectile.vx * 0.7, y - projectile.vz * 0.14, 12, orb.fillColor, 0.16);
      this.projectileLayer.add([trail, orb]);
    }
  }

  renderGhosting() {
    this.ghostLayer.removeAll(true);
    if (this.player.actionState === 'dashing') this.spawnDashTrail(this.player);
    if (this.enemy.actionState === 'dashing') this.spawnDashTrail(this.enemy, true);
  }

  spawnDashTrail(fighter, isEnemy = false) {
    const ghost = this.add.circle(fighter.x, this.toScreenY(fighter.y, fighter.z), 18, isEnemy ? 0xff7de1 : 0x7efbff, 0.12);
    this.ghostLayer.add(ghost);
    this.tweens.add({ targets: ghost, alpha: 0, scale: 1.8, duration: 180, onComplete: () => ghost.destroy() });
  }

  spawnStepPulse(fighter) {
    const pulse = this.add.circle(fighter.x, this.toScreenY(fighter.y, fighter.z), 10, 0xf4ffff, 0.3);
    this.tweens.add({ targets: pulse, alpha: 0, scale: 5, duration: 120, onComplete: () => pulse.destroy() });
  }

  updateHud() {
    this.ui.p1Hp.width = 2.8 * this.player.health;
    this.ui.p2Hp.width = 2.8 * this.enemy.health;
    this.ui.boostBar.width = 2.8 * this.player.boost;
    this.ui.boostBar.fillColor = this.player.isOverheated ? 0xff7b37 : 0x8fff62;

    const range = getDistance3D(this.player, this.enemy);
    this.ui.detail.setText(`RANGE ${range.toFixed(0)} | BOOST ${this.player.boost.toFixed(0)} | ${this.player.actionState.toUpperCase()}`);
    if (this.player.isOverheated) this.ui.status.setText('OVERHEAT: IMMOBILIZED 1.5s');
    else this.ui.status.setText('LOCK-ON ENGAGED');
  }

  toScreenY(altitude, depth) {
    return 760 - altitude + depth * 0.17;
  }

  botThink() {
    if (this.mode !== 'bot' || this.enemy.isKO) return;
    const dx = this.player.x - this.enemy.x;
    const dz = this.player.z - this.enemy.z;
    const distance = Math.hypot(dx, dz);

    if (distance > 230) {
      this.enemy.vx = (dx / distance) * 9;
      this.enemy.vz = (dz / distance) * 9;
      if (Math.random() > 0.65) applyBoostDash(this.enemy, { x: dx / distance, z: dz / distance }, Date.now());
      return;
    }

    const actions = ['SHOOT', 'MELEE', 'HEAVY_MELEE'];
    const choice = Phaser.Utils.Array.GetRandom(actions);
    const result = resolveAction(this.enemy, this.player, choice, Date.now(), this.match.projectiles);
    if (choice === 'HEAVY_MELEE' && result.applied) this.cameras.main.shake(120, 0.01);
    if (!result.applied && Math.random() > 0.4) applyBoostStep(this.enemy, { x: -dx, z: -dz }, Date.now());
  }
}
