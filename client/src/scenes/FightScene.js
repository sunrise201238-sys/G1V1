import { io } from 'socket.io-client';
import {
  ARENA,
  BOOST,
  MOVE_SET,
  createFighterState,
  resolveAction,
  applyBoostDash,
  applyBoostStep,
  applyVerticalThrust,
  tickFighter,
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
    this.add.rectangle(640, 360, 1280, 720, 0x05070d);
    this.createStage();

    this.fighters = {
      p1: createFighterState('p1', 320, 260, this.playerCharacter.id),
      p2: createFighterState('p2', 940, 620, this.enemyCharacter.id)
    };

    this.rigs = {
      p1: this.createRig(this.fighters.p1, this.playerCharacter.color),
      p2: this.createRig(this.fighters.p2, this.enemyCharacter.color)
    };

    this.ui = this.createHud();
    this.inputBuffer = createInputBuffer(10);
    this.touch = this.createTouchControls();

    this.socket = null;
    this.interpolationBuffer = [];
    if (this.mode === 'online') this.setupSocket();

    this.time.addEvent({ delay: 430, loop: true, callback: () => this.botThink() });
  }

  setupSocket() {
    this.socket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:3001');
    this.socket.on('match:snapshot', (snapshot) => {
      this.interpolationBuffer.push(snapshot);
      if (this.interpolationBuffer.length > 5) this.interpolationBuffer.shift();
    });
  }

  createStage() {
    const g = this.add.graphics({ lineStyle: { width: 1, color: 0x56f4ff, alpha: 0.35 } });
    for (let x = 0; x <= ARENA.width; x += 80) g.lineBetween(x, 100, x, 660);
    for (let y = 100; y <= 660; y += 56) g.lineBetween(0, y, ARENA.width, y);
    this.add.text(16, 14, '1v1 Lock-On | Left: move / dash | Right: shoot, melee, step, rise, drop', {
      fontSize: '18px',
      color: '#95fffb'
    });
  }

  createRig(fighter, color) {
    const container = this.add.container(fighter.x, this.toScreenY(fighter.y, fighter.z));
    const parts = this.add.graphics({ lineStyle: { width: 4, color } });
    parts.strokeCircle(0, -74, 20);
    parts.strokeRect(-24, -44, 48, 72);
    parts.strokeRect(-42, 34, 30, 10);
    parts.strokeRect(12, 34, 30, 10);
    parts.strokeRect(-62, -24, 38, 10);
    parts.strokeRect(24, -24, 38, 10);
    container.add(parts);
    return container;
  }

  createHud() {
    const p1Hp = this.add.rectangle(40, 44, 280, 20, 0x21f2ff).setOrigin(0, 0.5);
    const p2Hp = this.add.rectangle(960, 44, 280, 20, 0xff4eca).setOrigin(0, 0.5);
    const boostBar = this.add.rectangle(40, 72, 280, 14, 0x82ff6c).setOrigin(0, 0.5);

    return {
      p1Hp,
      p2Hp,
      boostBar,
      status: this.add.text(530, 40, 'LOCKED-ON', { fontSize: '24px', color: '#ffffff' }),
      distance: this.add.text(530, 68, 'RANGE', { fontSize: '16px', color: '#95fffb' })
    };
  }

  createTouchControls() {
    const joystickBase = this.add.circle(110, 610, 78, 0x111824, 0.75).setScrollFactor(0).setDepth(1000);
    const joystickThumb = this.add.circle(110, 610, 34, 0x56f4ff, 0.9).setScrollFactor(0).setDepth(1001);

    const buttons = {
      shoot: this.makeButton(1115, 590, 'SHOOT'),
      melee: this.makeButton(1000, 650, 'MELEE'),
      boostStep: this.makeButton(1140, 680, 'STEP'),
      rise: this.makeButton(1030, 530, 'RISE'),
      drop: this.makeButton(1190, 530, 'DROP')
    };

    const state = { x: 0, z: 0, isDashGesture: false, pointer: null, lastTap: 0 };

    joystickBase.setInteractive();
    joystickBase.on('pointerdown', (pointer) => {
      if (state.pointer && state.pointer.id !== pointer.id) return;
      const delta = pointer.downTime - state.lastTap;
      state.isDashGesture = delta < 220;
      state.lastTap = pointer.downTime;
      state.pointer = pointer;
      this.updateJoystick(state, joystickThumb, pointer);
    });

    this.input.on('pointermove', (pointer) => {
      if (!state.pointer || pointer.id !== state.pointer.id) return;
      this.updateJoystick(state, joystickThumb, pointer);
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

    buttons.shoot.on('pointerdown', () => this.inputBuffer.push({ type: 'SHOOT' }));
    buttons.melee.on('pointerdown', () => this.inputBuffer.push({ type: 'MELEE' }));
    buttons.boostStep.on('pointerdown', () => this.inputBuffer.push({ type: 'BOOST_STEP' }));
    buttons.rise.on('pointerdown', () => this.inputBuffer.push({ type: 'VERTICAL_THRUST', vertical: 1 }));
    buttons.drop.on('pointerdown', () => this.inputBuffer.push({ type: 'VERTICAL_THRUST', vertical: -1 }));

    return { state, joystickBase, joystickThumb, buttons };
  }

  makeButton(x, y, label) {
    const button = this.add.circle(x, y, 42, 0x1a2735, 0.95).setDepth(1000).setInteractive();
    this.add.text(x - 24, y - 9, label, { fontSize: '16px', color: '#d8fdff' }).setDepth(1001);
    return button;
  }

  updateJoystick(state, thumb, pointer) {
    const dx = pointer.x - this.touch.joystickBase.x;
    const dy = pointer.y - this.touch.joystickBase.y;
    const length = Math.min(58, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    thumb.x = this.touch.joystickBase.x + Math.cos(angle) * length;
    thumb.y = this.touch.joystickBase.y + Math.sin(angle) * length;

    state.x = Math.cos(angle) * (length / 58);
    state.z = Math.sin(angle) * (length / 58);
  }

  update(_time, _delta) {
    if (this.fighters.p1.isKO || this.fighters.p2.isKO) {
      const winner = this.fighters.p1.isKO ? this.enemyCharacter : this.playerCharacter;
      this.scene.start('Result', { winner, playerCharacter: this.playerCharacter, enemyCharacter: this.enemyCharacter });
      return;
    }

    this.handleBufferedInputs();
    this.handleMovement();

    tickFighter(this.fighters.p1);
    tickFighter(this.fighters.p2);

    this.applySnapshotInterpolation();
    this.updateCameraLock();
    this.renderFighters();
    this.updateHud();
  }

  handleMovement() {
    const move = this.touch.state;
    if (Math.hypot(move.x, move.z) > 0.15) {
      this.fighters.p1.vx = move.x * BOOST.cruiseSpeed;
      this.fighters.p1.vz = move.z * BOOST.cruiseSpeed;
      this.fighters.p1.facing = move.x >= 0 ? 1 : -1;

      if (move.isDashGesture) {
        applyBoostDash(this.fighters.p1, move, Date.now());
        this.socket?.emit('input:action', { type: 'BOOST_DASH', move });
      }
    }
  }

  handleBufferedInputs() {
    const inputs = this.inputBuffer.flush();
    const now = Date.now();

    for (const input of inputs) {
      if (input.type === 'BOOST_STEP') {
        const ok = applyBoostStep(this.fighters.p1, this.touch.state, now);
        if (ok) this.socket?.emit('input:action', { type: 'BOOST_STEP', move: this.touch.state });
        continue;
      }

      if (input.type === 'VERTICAL_THRUST') {
        applyVerticalThrust(this.fighters.p1, input.vertical);
        this.socket?.emit('input:action', { type: 'VERTICAL_THRUST', vertical: input.vertical });
        continue;
      }

      const result = resolveAction(this.fighters.p1, this.fighters.p2, input.type, now);
      this.socket?.emit('input:action', { type: input.type });

      if (result.applied) {
        this.flash(this.rigs.p2, 0xff3344);
        this.ui.status.setText(`${MOVE_SET[input.type].name} -${result.damage}`);
      } else if (result.cut) {
        this.ui.status.setText('Tracking cut by enemy step');
      } else {
        this.ui.status.setText(result.whiff ? `${MOVE_SET[input.type].name} missed` : 'Recovery / cooldown');
      }
    }
  }

  applySnapshotInterpolation() {
    if (this.mode !== 'online' || this.interpolationBuffer.length < 2) return;
    const prev = this.interpolationBuffer[this.interpolationBuffer.length - 2];
    const next = this.interpolationBuffer[this.interpolationBuffer.length - 1];
    const smoothed = interpolateSnapshot(prev, next, 0.5);
    if (!smoothed?.fighters) return;
    this.fighters.p2 = { ...this.fighters.p2, ...smoothed.fighters.p2 };
  }

  updateCameraLock() {
    const midX = (this.rigs.p1.x + this.rigs.p2.x) / 2;
    const midY = (this.rigs.p1.y + this.rigs.p2.y) / 2;
    const distance = Phaser.Math.Distance.Between(this.rigs.p1.x, this.rigs.p1.y, this.rigs.p2.x, this.rigs.p2.y);
    const zoom = Phaser.Math.Clamp(1.35 - distance / 1300, 0.85, 1.35);

    this.cameras.main.centerOn(midX, midY);
    this.cameras.main.setZoom(zoom);
  }

  renderFighters() {
    this.rigs.p1.x = this.fighters.p1.x;
    this.rigs.p1.y = this.toScreenY(this.fighters.p1.y, this.fighters.p1.z);
    this.rigs.p2.x = this.fighters.p2.x;
    this.rigs.p2.y = this.toScreenY(this.fighters.p2.y, this.fighters.p2.z);
  }

  updateHud() {
    this.ui.p1Hp.width = 2.8 * this.fighters.p1.health;
    this.ui.p2Hp.width = 2.8 * this.fighters.p2.health;
    this.ui.boostBar.width = 2.8 * this.fighters.p1.boost;
    this.ui.boostBar.fillColor = this.fighters.p1.isOverheated ? 0xff8b3d : 0x82ff6c;

    const dist = getDistance3D(this.fighters.p1, this.fighters.p2);
    this.ui.distance.setText(`LOCK: ${this.fighters.p1.lockTargetId} | RANGE: ${dist.toFixed(0)} | STATE: ${this.fighters.p1.actionState}`);
  }

  toScreenY(altitude, depth) {
    return 760 - altitude + depth * 0.17;
  }

  botThink() {
    if (this.mode !== 'bot' || this.fighters.p2.isKO) return;

    const dx = this.fighters.p1.x - this.fighters.p2.x;
    const dz = this.fighters.p1.z - this.fighters.p2.z;
    const distance = Math.hypot(dx, dz);

    if (distance > 180) {
      this.fighters.p2.vx = (dx / distance) * 9;
      this.fighters.p2.vz = (dz / distance) * 9;
      return;
    }

    const actions = ['SHOOT', 'SUB_SHOOT', 'MELEE'];
    const choice = Phaser.Utils.Array.GetRandom(actions);
    const result = resolveAction(this.fighters.p2, this.fighters.p1, choice, Date.now());
    if (result.applied) {
      this.flash(this.rigs.p1, 0xff3344);
      this.ui.status.setText(`ENEMY ${MOVE_SET[choice].name}`);
    } else if (Math.random() > 0.5) {
      applyBoostStep(this.fighters.p2, { x: -dx, z: -dz }, Date.now());
    }
  }

  flash(target, tint) {
    target.list[0].clear();
    target.list[0].lineStyle(6, tint);
    target.list[0].strokeCircle(0, -74, 20);
    target.list[0].strokeRect(-24, -44, 48, 72);
    target.list[0].strokeRect(-42, 34, 30, 10);
    target.list[0].strokeRect(12, 34, 30, 10);
    target.list[0].strokeRect(-62, -24, 38, 10);
    target.list[0].strokeRect(24, -24, 38, 10);

    this.time.delayedCall(100, () => {
      target.list[0].clear();
      target.list[0].lineStyle(4, target === this.rigs.p1 ? this.playerCharacter.color : this.enemyCharacter.color);
      target.list[0].strokeCircle(0, -74, 20);
      target.list[0].strokeRect(-24, -44, 48, 72);
      target.list[0].strokeRect(-42, 34, 30, 10);
      target.list[0].strokeRect(12, 34, 30, 10);
      target.list[0].strokeRect(-62, -24, 38, 10);
      target.list[0].strokeRect(24, -24, 38, 10);
    });
  }
}
