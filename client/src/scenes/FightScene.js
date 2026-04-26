import { io } from 'socket.io-client';
import {
  BOOST,
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

    this.cameraRig = {
      x: this.match.fighters.p1.x - 220,
      y: this.match.fighters.p1.y + 120,
      z: this.match.fighters.p1.z - 140,
      yaw: 0,
      pitch: -0.22,
      fov: 60,
      roll: 0
    };

    this.createArena();
    this.rigs = {
      p1: this.createWireRig(this.playerCharacter.color),
      p2: this.createWireRig(this.enemyCharacter.color)
    };

    this.projectileLayer = this.add.layer();
    this.trailLayer = this.add.layer();
    this.diegeticHudLayer = this.add.layer();

    this.ui = this.createDiegeticHud();
    this.inputBuffer = createInputBuffer(12);
    this.touch = this.createTouchControls();

    this.socket = null;
    this.interpolationBuffer = [];
    if (this.mode === 'online') this.setupSocket();

    this.isKOSequence = false;
    this.koWinner = null;
    this.koOrbitProgress = 0;

    this.time.addEvent({ delay: 360, loop: true, callback: () => this.botThink() });
  }

  setupSocket() {
    this.socket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:3001');
    this.socket.on('match:snapshot', (snapshot) => {
      this.interpolationBuffer.push(snapshot);
      if (this.interpolationBuffer.length > 6) this.interpolationBuffer.shift();
    });
  }

  createArena() {
    this.skyGradient = this.add.graphics();
    this.skyGradient.fillGradientStyle(0x0d1222, 0x0d1222, 0x1f273a, 0x1f273a, 1);
    this.skyGradient.fillRect(0, 0, 1280, 720);

    this.floor = this.add.graphics();
    this.floor.fillStyle(0x291513, 1);
    this.floor.fillRect(0, 420, 1280, 300);

    this.floorTexture = this.add.graphics({ lineStyle: { width: 2, color: 0xff7c47, alpha: 0.25 } });
    for (let i = 0; i < 10; i += 1) {
      this.floorTexture.lineBetween(0, 460 + i * 24, 1280, 420 + i * 18);
    }
  }

  createWireRig(color) {
    const container = this.add.container(640, 380);
    const gfx = this.add.graphics({ lineStyle: { width: 3, color, alpha: 0.98 } });
    gfx.strokeCircle(0, -52, 14);
    gfx.strokeRoundedRect(-20, -34, 40, 68, 5);
    gfx.strokeTriangle(-30, -14, -54, 8, -20, 12);
    gfx.strokeTriangle(30, -14, 54, 8, 20, 12);
    gfx.strokeRect(-26, 34, 20, 12);
    gfx.strokeRect(6, 34, 20, 12);
    container.add(gfx);
    return container;
  }

  createDiegeticHud() {
    const status = this.add.text(512, 26, 'FOLLOW-CAM LOCK', { fontSize: '20px', color: '#d8fcff' });
    status.setAlpha(0.82).setScrollFactor(0);

    const p1Bar = this.add.graphics().setAlpha(0.72);
    const p2Bar = this.add.graphics().setAlpha(0.72);
    return { status, p1Bar, p2Bar };
  }

  createTouchControls() {
    const joystickBase = this.add.circle(122, 612, 82, 0x1d2530, 0.18).setDepth(1000).setInteractive();
    const joystickThumb = this.add.circle(122, 612, 35, 0xeffbff, 0.32).setDepth(1001);

    const buttons = {
      boost: this.makeButton(1036, 640, 'BOOST'),
      shoot: this.makeButton(1160, 598, 'SHOOT'),
      melee: this.makeButton(938, 678, 'MELEE'),
      step: this.makeButton(1160, 694, 'STEP'),
      rise: this.makeButton(1036, 540, 'RISE'),
      drop: this.makeButton(1160, 510, 'DROP')
    };

    const state = { x: 0, z: 0, isDashGesture: false, pointer: null, lastTap: 0, boosting: false };

    joystickBase.on('pointerdown', (pointer) => {
      if (state.pointer && state.pointer.id !== pointer.id) return;
      state.isDashGesture = pointer.downTime - state.lastTap < 220;
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
    const button = this.add.circle(x, y, 48, 0xc0f6ff, 0.16).setDepth(1000).setInteractive();
    this.add.text(x - 23, y - 8, label, { fontSize: '13px', color: '#d5faff' }).setDepth(1001);
    return button;
  }

  updateJoystick(state, base, thumb, pointer) {
    const dx = pointer.x - base.x;
    const dy = pointer.y - base.y;
    const length = Math.min(60, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    thumb.x = base.x + Math.cos(angle) * length;
    thumb.y = base.y + Math.sin(angle) * length;
    state.x = Math.cos(angle) * (length / 60);
    state.z = Math.sin(angle) * (length / 60);
  }

  get player() {
    return this.match.fighters.p1;
  }

  get enemy() {
    return this.match.fighters.p2;
  }

  update(_time, delta) {
    if (this.isKOSequence) {
      this.runKOCinematic(delta);
      return;
    }

    this.handleBufferedInputs();
    this.handleMovement();

    if (this.mode !== 'online') {
      const hits = tickMatch(this.match, Date.now());
      if (hits.some((h) => h.targetId === 'p1' || h.targetId === 'p2')) this.hitStop(26);
    }
    this.applySnapshotInterpolation();

    this.updateFollowCam(delta);
    this.renderFighters();
    this.renderProjectiles();
    this.renderTrails();
    this.renderDiegeticHud();
    this.checkKO();
  }

  handleMovement() {
    const move = this.touch.state;
    if (Math.hypot(move.x, move.z) < 0.1 || this.player.isOverheated) return;

    this.player.vx = move.x * BOOST.cruiseSpeed;
    this.player.vz = move.z * BOOST.cruiseSpeed;
    this.player.facing = move.x >= 0 ? 1 : -1;
    if (move.isDashGesture || move.boosting) this.tryDash(move);
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
        if (stepped) {
          this.spawnStepDistortion();
          this.socket?.emit('input:action', { type: 'BOOST_STEP', move });
        }
        continue;
      }
      if (input.type === 'VERTICAL_THRUST') {
        applyVerticalThrust(this.player, input.vertical, now);
        this.socket?.emit('input:action', { type: 'VERTICAL_THRUST', vertical: input.vertical });
        continue;
      }

      const result = resolveAction(this.player, this.enemy, input.type, now, this.match.projectiles);
      this.socket?.emit('input:action', { type: input.type });
      if (result.applied) {
        this.hitStop(40);
        this.cameras.main.shake(80, 0.006);
      }
      if (result.heavy && result.applied) {
        this.cameras.main.shake(140, 0.012);
        this.hitStop(70);
      }
    }
  }

  tryDash(move) {
    const dashed = applyBoostDash(this.player, move, Date.now());
    if (dashed) {
      this.socket?.emit('input:action', { type: 'BOOST_DASH', move });
      this.spawnDashTrail(this.player, false);
    }
  }

  applySnapshotInterpolation() {
    if (this.mode !== 'online' || this.interpolationBuffer.length < 2) return;

    const prev = this.interpolationBuffer[this.interpolationBuffer.length - 2];
    const next = this.interpolationBuffer[this.interpolationBuffer.length - 1];
    const smooth = interpolateSnapshot(prev, next, 0.52);
    if (!smooth) return;

    this.match.fighters.p2 = { ...this.match.fighters.p2, ...smooth.fighters.p2 };
    this.match.projectiles = smooth.projectiles ?? this.match.projectiles;
  }

  updateFollowCam(delta) {
    const player = this.player;
    const enemy = this.enemy;

    const mid = {
      x: (player.x + enemy.x) / 2,
      y: (player.y + enemy.y) / 2,
      z: (player.z + enemy.z) / 2
    };

    const range = getDistance3D(player, enemy);
    const meleeFactor = Phaser.Math.Clamp(1 - range / 420, 0, 1);
    const dashFactor = player.actionState === 'dashing' ? 1 : 0;

    const desiredFov = Phaser.Math.Clamp(75 - meleeFactor * 30 + dashFactor * 8, 45, 78);
    this.cameraRig.fov = Phaser.Math.Linear(this.cameraRig.fov, desiredFov, 0.08);

    const desiredPitch = Phaser.Math.Clamp(-0.23 - (player.y - enemy.y) / 1300, -0.48, -0.12);
    this.cameraRig.pitch = Phaser.Math.Linear(this.cameraRig.pitch, desiredPitch, 0.08);

    const desiredYaw = Math.atan2(enemy.z - player.z, enemy.x - player.x);
    this.cameraRig.yaw = Phaser.Math.Angle.RotateTo(this.cameraRig.yaw, desiredYaw, 0.06);

    const backDistance = Phaser.Math.Linear(220, 380, Phaser.Math.Clamp(range / 900, 0, 1));
    const shoulderOffset = 90;
    const desiredX = player.x - Math.cos(this.cameraRig.yaw) * backDistance + Math.sin(this.cameraRig.yaw) * shoulderOffset;
    const desiredZ = player.z - Math.sin(this.cameraRig.yaw) * backDistance - Math.cos(this.cameraRig.yaw) * shoulderOffset;
    const desiredY = player.y + 130;

    this.cameraRig.x = Phaser.Math.Linear(this.cameraRig.x, desiredX, 0.12);
    this.cameraRig.y = Phaser.Math.Linear(this.cameraRig.y, desiredY, 0.12);
    this.cameraRig.z = Phaser.Math.Linear(this.cameraRig.z, desiredZ, 0.12);

    this.cameraRig.lookAt = mid;
    this.ui.status.setText(player.isOverheated ? 'OVERHEAT RECOVERY' : 'FOLLOW-CAM LOCK');

    if (Math.abs(player.vy) > 3.4 && player.y <= 72) this.cameras.main.shake(60, 0.004);
    this.cameras.main.setZoom(1 + (60 - this.cameraRig.fov) / 220);
  }

  projectWorldToScreen(world) {
    const cam = this.cameraRig;
    const dx = world.x - cam.x;
    const dy = world.y - cam.y;
    const dz = world.z - cam.z;

    const cosYaw = Math.cos(-cam.yaw);
    const sinYaw = Math.sin(-cam.yaw);
    const x1 = dx * cosYaw - dz * sinYaw;
    const z1 = dx * sinYaw + dz * cosYaw;

    const cosPitch = Math.cos(-cam.pitch);
    const sinPitch = Math.sin(-cam.pitch);
    const y2 = dy * cosPitch - z1 * sinPitch;
    const z2 = dy * sinPitch + z1 * cosPitch;

    const focal = 650 / Math.tan((cam.fov * Math.PI) / 360);
    const depth = Math.max(90, z2 + 420);
    const scale = focal / depth;

    return {
      x: 640 + x1 * scale,
      y: 360 + y2 * scale,
      scale: Phaser.Math.Clamp(scale * 1.8, 0.3, 2.2),
      depth
    };
  }

  renderFighters() {
    const p1Screen = this.projectWorldToScreen(this.player);
    const p2Screen = this.projectWorldToScreen(this.enemy);

    this.rigs.p1.setPosition(p1Screen.x, p1Screen.y).setScale(p1Screen.scale);
    this.rigs.p2.setPosition(p2Screen.x, p2Screen.y).setScale(p2Screen.scale);
    this.rigs.p1.setDepth(2000 - p1Screen.depth);
    this.rigs.p2.setDepth(2000 - p2Screen.depth);
  }

  renderProjectiles() {
    this.projectileLayer.removeAll(true);
    for (const projectile of this.match.projectiles) {
      const p = this.projectWorldToScreen(projectile);
      const color = projectile.ownerId === 'p1' ? 0x7dfbff : 0xff7de2;
      const orb = this.add.circle(p.x, p.y, 5 * p.scale, color, 0.9);
      const trail = this.add.circle(p.x - projectile.vx * 0.25, p.y - projectile.vz * 0.08, 12 * p.scale, color, 0.14);
      orb.setDepth(2000 - p.depth + 1);
      trail.setDepth(2000 - p.depth);
      this.projectileLayer.add([trail, orb]);
    }
  }

  renderTrails() {
    this.trailLayer.removeAll(true);
    if (this.player.actionState === 'dashing') this.spawnDashTrail(this.player, false);
    if (this.enemy.actionState === 'dashing') this.spawnDashTrail(this.enemy, true);
  }

  spawnDashTrail(fighter, enemy) {
    const p = this.projectWorldToScreen(fighter);
    const ghost = this.add.circle(p.x, p.y, 20 * p.scale, enemy ? 0xff7de2 : 0x7dfbff, 0.14);
    ghost.setDepth(2000 - p.depth - 1);
    this.trailLayer.add(ghost);
    this.tweens.add({ targets: ghost, alpha: 0, scale: 1.8, duration: 180, onComplete: () => ghost.destroy() });
  }

  spawnStepDistortion() {
    const flash = this.add.rectangle(640, 360, 1280, 720, 0xd6f9ff, 0.08).setDepth(5000);
    this.tweens.add({ targets: flash, alpha: 0, duration: 90, onComplete: () => flash.destroy() });
    this.cameras.main.shake(70, 0.004);
  }

  renderDiegeticHud() {
    const drawBar = (gfx, fighter, hpColor, boostColor) => {
      const anchor = this.projectWorldToScreen({ x: fighter.x, y: fighter.y + 78, z: fighter.z });
      const width = 80 * anchor.scale;
      const hpWidth = width * (fighter.health / 100);
      const boostWidth = width * (fighter.boost / 100);
      gfx.clear();
      gfx.fillStyle(0x0a121a, 0.46);
      gfx.fillRoundedRect(anchor.x - width / 2, anchor.y - 10, width, 7, 3);
      gfx.fillRoundedRect(anchor.x - width / 2, anchor.y, width, 6, 3);
      gfx.fillStyle(hpColor, 0.88);
      gfx.fillRoundedRect(anchor.x - width / 2, anchor.y - 10, hpWidth, 7, 3);
      gfx.fillStyle(boostColor, 0.82);
      gfx.fillRoundedRect(anchor.x - width / 2, anchor.y, boostWidth, 6, 3);
      gfx.setDepth(3000);
    };

    drawBar(this.ui.p1Bar, this.player, 0x67f4ff, this.player.isOverheated ? 0xff8c45 : 0x90ff63);
    drawBar(this.ui.p2Bar, this.enemy, 0xff74e3, 0x8ec0ff);
  }

  hitStop(durationMs) {
    this.physics.world?.pause();
    this.time.timeScale = 0.02;
    this.time.delayedCall(durationMs, () => {
      this.time.timeScale = 1;
      this.physics.world?.resume();
    });
  }

  checkKO() {
    if (this.player.isKO || this.enemy.isKO) {
      this.isKOSequence = true;
      this.koWinner = this.player.isKO ? 'p2' : 'p1';
      this.koOrbitProgress = 0;
      this.time.timeScale = 0.35;
    }
  }

  runKOCinematic(delta) {
    this.koOrbitProgress += delta;
    const winner = this.match.fighters[this.koWinner];
    const loser = this.match.fighters[this.koWinner === 'p1' ? 'p2' : 'p1'];
    const t = Math.min(1, this.koOrbitProgress / 2000);

    const orbit = t * Math.PI * 2;
    this.cameraRig.x = winner.x + Math.cos(orbit) * 220;
    this.cameraRig.z = winner.z + Math.sin(orbit) * 220;
    this.cameraRig.y = winner.y + 140;
    this.cameraRig.yaw = Math.atan2(loser.z - this.cameraRig.z, loser.x - this.cameraRig.x);
    this.cameraRig.pitch = -0.25;
    this.cameraRig.fov = 52;

    this.renderFighters();
    this.renderProjectiles();
    this.renderDiegeticHud();

    if (t >= 1) {
      this.time.timeScale = 1;
      const winnerCharacter = this.koWinner === 'p1' ? this.playerCharacter : this.enemyCharacter;
      this.scene.start('Result', { winner: winnerCharacter, playerCharacter: this.playerCharacter, enemyCharacter: this.enemyCharacter });
    }
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
    if (result.applied) {
      this.hitStop(28);
      if (result.heavy) this.cameras.main.shake(120, 0.01);
    }
    if (!result.applied && Math.random() > 0.4) applyBoostStep(this.enemy, { x: -dx, z: -dz }, Date.now());
  }
}
