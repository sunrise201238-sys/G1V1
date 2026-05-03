import {
  BOOST,
  createMatchState,
  applyMoveVector,
  resolveAction,
  applyBoostDash,
  applyBoostStep,
  applyVerticalThrust,
  tickMatch,
  createInputBuffer,
  interpolateSnapshot,
  getDistance3D
} from '@gvg/shared/src/gameLogic.js';

const INTERPOLATION_BACK_TIME_MS = 100;

export class FightScene extends Phaser.Scene {
  constructor() {
    super('Fight');
  }

  init(data) {
    this.playerCharacter = data.playerCharacter;
    this.enemyCharacter = data.enemyCharacter;
    this.mode = 'bot';
  }

  create() {
    this.match = createMatchState();
    this.match.fighters.p1.characterId = this.playerCharacter.id;
    this.match.fighters.p2.characterId = this.enemyCharacter.id;

    this.cameraRig = {
      x: this.match.fighters.p1.x - 220,
      y: this.match.fighters.p1.y + 140,
      z: this.match.fighters.p1.z - 140,
      lookAt: { ...this.match.fighters.p2 },
      fov: 60
    };

    this.createArena();
    this.rigs = {
      p1: this.createMechRig(this.playerCharacter.color),
      p2: this.createMechRig(this.enemyCharacter.color)
    };

    this.projectileMap = new Map();
    this.ui = this.createHud();
    this.inputBuffer = createInputBuffer(12);
    this.touch = this.createTouchControls();

    this.snapshotBuffer = [];

    this.isKOSequence = false;
    this.koWinner = null;
    this.koOrbitProgress = 0;

    this.time.addEvent({ delay: 360, loop: true, callback: () => this.botThink() });
  }

  createArena() {
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x080b11, 0x080b11, 0x1a202d, 0x1a202d, 1);
    sky.fillRect(0, 0, 1280, 720);

    const floor = this.add.graphics();
    floor.fillStyle(0x21252f, 1);
    floor.fillRect(0, 400, 1280, 320);

    const scuffs = this.add.graphics({ lineStyle: { width: 2, color: 0x5a6477, alpha: 0.25 } });
    for (let i = 0; i < 8; i += 1) {
      scuffs.lineBetween(0, 430 + i * 34, 1280, 430 + i * 24);
      scuffs.lineBetween(i * 160, 410, i * 180 + 40, 700);
    }
  }

  createMechRig(color) {
    const container = this.add.container(640, 380);

    const core = this.add.graphics();
    core.fillStyle(0x586273, 0.95);
    core.fillRoundedRect(-24, -28, 48, 54, 6);
    core.lineStyle(2, color, 0.9);
    core.strokeRoundedRect(-24, -28, 48, 54, 6);

    const head = this.add.graphics();
    head.fillStyle(0x6a7384, 0.95);
    head.fillRoundedRect(-12, -46, 24, 18, 4);
    head.lineStyle(2, color, 0.95);
    head.strokeRoundedRect(-12, -46, 24, 18, 4);

    const leftArm = this.add.graphics();
    leftArm.fillStyle(0x4c5565, 0.95);
    leftArm.fillRoundedRect(-44, -20, 18, 38, 4);
    leftArm.lineStyle(2, color, 0.85);
    leftArm.strokeRoundedRect(-44, -20, 18, 38, 4);

    const rightArm = this.add.graphics();
    rightArm.fillStyle(0x4c5565, 0.95);
    rightArm.fillRoundedRect(26, -20, 18, 38, 4);
    rightArm.lineStyle(2, color, 0.85);
    rightArm.strokeRoundedRect(26, -20, 18, 38, 4);

    const legs = this.add.graphics();
    legs.fillStyle(0x3d4656, 0.95);
    legs.fillRoundedRect(-22, 24, 18, 34, 3);
    legs.fillRoundedRect(4, 24, 18, 34, 3);
    legs.lineStyle(2, color, 0.75);
    legs.strokeRoundedRect(-22, 24, 18, 34, 3);
    legs.strokeRoundedRect(4, 24, 18, 34, 3);

    const boosterL = this.add.ellipse(-16, 42, 10, 16, 0x7dfbff, 0.1);
    const boosterR = this.add.ellipse(16, 42, 10, 16, 0x7dfbff, 0.1);

    container.add([boosterL, boosterR, legs, leftArm, rightArm, core, head]);
    container.setDataEnabled();
    container.setData('boosterL', boosterL);
    container.setData('boosterR', boosterR);
    return container;
  }

  createHud() {
    const status = this.add.text(520, 22, 'LOCK-ON ENGAGED', { fontSize: '18px', color: '#d8fcff' }).setAlpha(0.82);
    const boostBg = this.add.rectangle(640, 690, 320, 10, 0x0a121a, 0.6).setScrollFactor(0);
    const boostFill = this.add.rectangle(480, 690, 0, 10, 0x90ff63, 0.8).setOrigin(0, 0.5).setScrollFactor(0);
    const p1Bar = this.add.graphics().setAlpha(0.72);
    const p2Bar = this.add.graphics().setAlpha(0.72);
    return { status, boostBg, boostFill, p1Bar, p2Bar };
  }

  createTouchControls() {
    const joystickBase = this.add.circle(122, 612, 82, 0x1d2530, 0.16).setDepth(1000).setInteractive();
    const joystickThumb = this.add.circle(122, 612, 35, 0xeffbff, 0.3).setDepth(1001);

    const buttons = {
      boost: this.makeButton(1036, 640, 'BOOST'),
      shoot: this.makeButton(1160, 598, 'SHOOT'),
      melee: this.makeButton(938, 678, 'MELEE'),
      step: this.makeButton(1160, 694, 'STEP'),
      rise: this.makeButton(1036, 540, 'RISE'),
      drop: this.makeButton(1160, 510, 'DROP')
    };

    const state = { x: 0, z: 0, pointer: null, lastTap: 0, boosting: false, dashGesture: false };

    joystickBase.on('pointerdown', (pointer) => {
      if (state.pointer && state.pointer.id !== pointer.id) return;
      state.dashGesture = pointer.downTime - state.lastTap < 220;
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
      state.dashGesture = false;
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

  setupSocket() {}

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

    tickMatch(this.match, Date.now());

    this.updateFollowCam();
    this.renderFighters();
    this.renderProjectiles();
    this.renderDiegeticBars();
    this.updateHud();
    this.checkKO();
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
        const ok = applyBoostStep(this.player, move, now);
        if (ok) this.spawnStepDistortion();
        continue;
      }

      if (input.type === 'VERTICAL_THRUST') {
        applyVerticalThrust(this.player, input.vertical, now);
        continue;
      }

      const result = resolveAction(this.player, this.enemy, input.type, now, this.match.projectiles);
      if (result.applied) this.cameras.main.shake(70, 0.005);
    }
  }

  handleMovement() {
    const move = this.touch.state;
    if (Math.hypot(move.x, move.z) < 0.1) return;

    if (!applyMoveVector(this.player, move, Date.now())) return;
    if (move.dashGesture || move.boosting) this.tryDash(move);
  }

  tryDash(move) {
    const dashed = applyBoostDash(this.player, move, Date.now());
    if (dashed) this.spawnDashTrail(this.player, false);
  }

  applySnapshotInterpolation(now) {
    if (this.snapshotBuffer.length === 0) return;
    const targetTime = now - INTERPOLATION_BACK_TIME_MS;

    while (this.snapshotBuffer.length >= 2 && this.snapshotBuffer[1].serverTime <= targetTime) this.snapshotBuffer.shift();

    if (this.snapshotBuffer.length === 1) {
      const snap = this.snapshotBuffer[0];
      this.match.fighters.p1 = { ...this.match.fighters.p1, ...snap.fighters.p1 };
      this.match.fighters.p2 = { ...this.match.fighters.p2, ...snap.fighters.p2 };
      this.match.projectiles = snap.projectiles ?? [];
      return;
    }

    const prev = this.snapshotBuffer[0];
    const next = this.snapshotBuffer[1];
    const span = Math.max(1, next.serverTime - prev.serverTime);
    const alpha = Phaser.Math.Clamp((targetTime - prev.serverTime) / span, 0, 1);
    const smooth = interpolateSnapshot(prev, next, alpha);
    if (!smooth) return;

    this.match.fighters.p1 = { ...this.match.fighters.p1, ...smooth.fighters.p1 };
    this.match.fighters.p2 = { ...this.match.fighters.p2, ...smooth.fighters.p2 };
    this.match.projectiles = smooth.projectiles ?? [];
  }

  updateFollowCam() {
    const player = this.player;
    const enemy = this.enemy;

    const playerToEnemy = { x: enemy.x - player.x, y: enemy.y - player.y, z: enemy.z - player.z };
    const range = getDistance3D(player, enemy);

    const meleeFactor = Phaser.Math.Clamp(1 - range / 450, 0, 1);
    const desiredFov = Phaser.Math.Clamp(75 - meleeFactor * 30 + (player.actionState === 'dashing' ? 6 : 0), 45, 78);
    this.cameraRig.fov = Phaser.Math.Linear(this.cameraRig.fov, desiredFov, 0.1);

    const dirLen = Math.max(1, Math.hypot(playerToEnemy.x, playerToEnemy.z));
    const dirX = playerToEnemy.x / dirLen;
    const dirZ = playerToEnemy.z / dirLen;

    const followDistance = Phaser.Math.Linear(230, 360, Phaser.Math.Clamp(range / 950, 0, 1));
    const shoulderOffset = 85;
    const desiredX = player.x - dirX * followDistance - dirZ * shoulderOffset;
    const desiredZ = player.z - dirZ * followDistance + dirX * shoulderOffset;
    const desiredY = player.y + Phaser.Math.Linear(120, 180, Phaser.Math.Clamp(Math.abs(playerToEnemy.y) / 260, 0, 1));

    this.cameraRig.x = Phaser.Math.Linear(this.cameraRig.x, desiredX, 0.12);
    this.cameraRig.y = Phaser.Math.Linear(this.cameraRig.y, desiredY, 0.12);
    this.cameraRig.z = Phaser.Math.Linear(this.cameraRig.z, desiredZ, 0.12);
    this.cameraRig.lookAt = { ...enemy };
  }

  getCameraAngles() {
    const dx = this.cameraRig.lookAt.x - this.cameraRig.x;
    const dy = this.cameraRig.lookAt.y - this.cameraRig.y;
    const dz = this.cameraRig.lookAt.z - this.cameraRig.z;
    return {
      yaw: Math.atan2(dz, dx),
      pitch: Math.atan2(dy, Math.hypot(dx, dz))
    };
  }

  projectWorldToScreen(world) {
    const cam = this.cameraRig;
    const { yaw, pitch } = this.getCameraAngles();

    const dx = world.x - cam.x;
    const dy = world.y - cam.y;
    const dz = world.z - cam.z;

    const cosYaw = Math.cos(-yaw);
    const sinYaw = Math.sin(-yaw);
    const x1 = dx * cosYaw - dz * sinYaw;
    const z1 = dx * sinYaw + dz * cosYaw;

    const cosPitch = Math.cos(-pitch);
    const sinPitch = Math.sin(-pitch);
    const y2 = dy * cosPitch - z1 * sinPitch;
    const z2 = dy * sinPitch + z1 * cosPitch;

    const focal = 650 / Math.tan((cam.fov * Math.PI) / 360);
    const depth = Math.max(80, z2 + 420);
    const scale = Phaser.Math.Clamp((focal / depth) * 1.85, 0.3, 2.25);

    return { x: 640 + x1 * scale, y: 360 + y2 * scale, scale, depth };
  }

  renderFighters() {
    const p1 = this.projectWorldToScreen(this.player);
    const p2 = this.projectWorldToScreen(this.enemy);

    this.rigs.p1.setPosition(p1.x, p1.y).setScale(p1.scale).setDepth(2000 - p1.depth);
    this.rigs.p2.setPosition(p2.x, p2.y).setScale(p2.scale).setDepth(2000 - p2.depth);

    this.updateBoosterState(this.rigs.p1, this.player);
    this.updateBoosterState(this.rigs.p2, this.enemy);
  }

  updateBoosterState(rig, fighter) {
    const active = fighter.actionState === 'dashing' || fighter.actionState === 'rising';
    const boosterL = rig.getData('boosterL');
    const boosterR = rig.getData('boosterR');
    const alpha = active ? 0.75 : 0.12;
    boosterL.setAlpha(alpha).setFillStyle(active ? 0x7efbff : 0x7efbff, alpha);
    boosterR.setAlpha(alpha).setFillStyle(active ? 0x7efbff : 0x7efbff, alpha);
    if (active && Math.random() > 0.65) this.spawnDashTrail(fighter, fighter.id === 'p2');
  }

  renderProjectiles() {
    const live = new Set();
    for (const projectile of this.match.projectiles) {
      live.add(projectile.id);
      const projected = this.projectWorldToScreen(projectile);
      let sprite = this.projectileMap.get(projectile.id);
      if (!sprite) {
        const color = projectile.ownerId === 'p1' ? 0x7dfbff : 0xff7de2;
        sprite = {
          trail: this.add.circle(projected.x, projected.y, 8, color, 0.14),
          orb: this.add.circle(projected.x, projected.y, 5, color, 0.9)
        };
        this.projectileMap.set(projectile.id, sprite);
      }

      sprite.orb.setPosition(projected.x, projected.y).setRadius(Math.max(2, 4 * projected.scale));
      sprite.orb.setDepth(2000 - projected.depth + 1);
      sprite.trail.setPosition(projected.x - projectile.vx * 0.25, projected.y - projectile.vz * 0.08).setRadius(Math.max(4, 10 * projected.scale));
      sprite.trail.setDepth(2000 - projected.depth);
    }

    for (const [id, sprite] of this.projectileMap.entries()) {
      if (live.has(id)) continue;
      sprite.orb.destroy();
      sprite.trail.destroy();
      this.projectileMap.delete(id);
    }
  }

  renderDiegeticBars() {
    const drawBar = (gfx, fighter, hpColor, boostColor) => {
      const anchor = this.projectWorldToScreen({ x: fighter.x, y: fighter.y + 92, z: fighter.z });
      const width = 94 * anchor.scale;
      gfx.clear();
      gfx.fillStyle(0x0a121a, 0.42);
      gfx.fillRoundedRect(anchor.x - width / 2, anchor.y - 12, width, 7, 3);
      gfx.fillRoundedRect(anchor.x - width / 2, anchor.y, width, 6, 3);
      gfx.fillStyle(hpColor, 0.86);
      gfx.fillRoundedRect(anchor.x - width / 2, anchor.y - 12, width * (fighter.health / 100), 7, 3);
      gfx.fillStyle(boostColor, 0.78);
      gfx.fillRoundedRect(anchor.x - width / 2, anchor.y, width * (fighter.boost / 100), 6, 3);
      gfx.setDepth(2800);
    };

    drawBar(this.ui.p1Bar, this.player, 0x67f4ff, this.player.isOverheated ? 0xff8c45 : 0x90ff63);
    drawBar(this.ui.p2Bar, this.enemy, 0xff74e3, 0x8ec0ff);
  }

  updateHud() {
    this.ui.status.setText(this.player.isOverheated ? 'LOCK-ON / OVERHEAT' : 'LOCK-ON ENGAGED');
    this.ui.boostFill.width = 320 * (this.player.boost / 100);
    this.ui.boostFill.fillColor = this.player.isOverheated ? 0xff8c45 : 0x90ff63;
  }

  spawnDashTrail(fighter, isEnemy) {
    const projected = this.projectWorldToScreen(fighter);
    const ghost = this.add.circle(projected.x, projected.y, 20 * projected.scale, isEnemy ? 0xff7de2 : 0x7dfbff, 0.1);
    ghost.setDepth(1900 - projected.depth);
    this.tweens.add({ targets: ghost, alpha: 0, scale: 1.8, duration: 160, onComplete: () => ghost.destroy() });
  }

  spawnStepDistortion() {
    const flash = this.add.rectangle(640, 360, 1280, 720, 0xd6f9ff, 0.06).setDepth(5000);
    this.tweens.add({ targets: flash, alpha: 0, duration: 90, onComplete: () => flash.destroy() });
    this.cameras.main.shake(60, 0.004);
  }

  checkKO() {
    if (!this.player.isKO && !this.enemy.isKO) return;
    this.isKOSequence = true;
    this.koWinner = this.player.isKO ? 'p2' : 'p1';
    this.koOrbitProgress = 0;
  }

  runKOCinematic(delta) {
    this.koOrbitProgress += delta;
    const winner = this.match.fighters[this.koWinner];
    const loser = this.match.fighters[this.koWinner === 'p1' ? 'p2' : 'p1'];
    const t = Math.min(1, this.koOrbitProgress / 2000);

    const orbit = t * Math.PI * 2;
    this.cameraRig.x = winner.x + Math.cos(orbit) * 220;
    this.cameraRig.z = winner.z + Math.sin(orbit) * 220;
    this.cameraRig.y = winner.y + 150;
    this.cameraRig.lookAt = { ...loser };
    this.cameraRig.fov = 52;

    this.renderFighters();
    this.renderProjectiles();
    this.renderDiegeticBars();

    if (t < 1) return;

    const winnerCharacter = this.koWinner === 'p1' ? this.playerCharacter : this.enemyCharacter;
    this.scene.start('Result', { winner: winnerCharacter, playerCharacter: this.playerCharacter, enemyCharacter: this.enemyCharacter });
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
    if (result.applied) this.cameras.main.shake(80, result.heavy ? 0.01 : 0.004);
    if (!result.applied && Math.random() > 0.4) applyBoostStep(this.enemy, { x: -dx, z: -dz }, Date.now());
  }
}
