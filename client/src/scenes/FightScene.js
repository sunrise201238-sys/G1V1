import { io } from 'socket.io-client';
import { ARENA, MOVE_SET, createFighterState, resolveAction, applyBoostDash, tickFighter } from '@gvg/shared/src/gameLogic.js';

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
    this.add.rectangle(640, 360, 1280, 720, 0x050714);
    this.createStage();

    this.fighters = {
      p1: createFighterState('p1', 350, this.playerCharacter.id),
      p2: createFighterState('p2', 930, this.enemyCharacter.id)
    };

    this.rigs = {
      p1: this.createRig(this.fighters.p1, this.playerCharacter.color),
      p2: this.createRig(this.fighters.p2, this.enemyCharacter.color)
    };

    this.ui = this.createHud();
    this.keys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      mainAttack: Phaser.Input.Keyboard.KeyCodes.J,
      subAttack: Phaser.Input.Keyboard.KeyCodes.K,
      spAttack: Phaser.Input.Keyboard.KeyCodes.L,
      mainMelee: Phaser.Input.Keyboard.KeyCodes.U,
      subMelee: Phaser.Input.Keyboard.KeyCodes.I,
      spMelee: Phaser.Input.Keyboard.KeyCodes.O,
      dash: Phaser.Input.Keyboard.KeyCodes.SPACE
    });

    this.socket = null;
    this.interpolationBuffer = [];
    if (this.mode === 'online') this.setupSocket();

    this.time.addEvent({ delay: 500, loop: true, callback: () => this.botThink() });
  }

  setupSocket() {
    this.socket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:3001');
    this.socket.on('match:snapshot', (snapshot) => {
      this.interpolationBuffer.push(snapshot);
      if (this.interpolationBuffer.length > 4) this.interpolationBuffer.shift();
    });
  }

  createStage() {
    const g = this.add.graphics({ lineStyle: { width: 2, color: 0x1ff3ff, alpha: 0.6 } });
    for (let i = 0; i < 11; i += 1) {
      g.lineBetween(90 + i * 110, 580, 130 + i * 110, 510);
    }
    this.add.text(20, 14, 'Controls: A/D move, SPACE boost dash, J/K/L attacks, U/I/O melee', {
      fontSize: '18px',
      color: '#95fffb'
    });
  }

  createRig(fighter, color) {
    const container = this.add.container(fighter.x, fighter.y);
    const parts = this.add.graphics({ lineStyle: { width: 5, color } });
    parts.strokeCircle(0, -90, 28);
    parts.strokeRect(-28, -55, 56, 85);
    parts.strokeRect(-50, 38, 36, 14);
    parts.strokeRect(14, 38, 36, 14);
    parts.strokeRect(-88, -33, 58, 12);
    parts.strokeRect(30, -33, 58, 12);
    container.add(parts);
    return container;
  }

  createHud() {
    const p1Bar = this.add.rectangle(220, 50, 320, 24, 0x00f2ff).setOrigin(0, 0.5);
    const p2Bar = this.add.rectangle(740, 50, 320, 24, 0xff48f5).setOrigin(0, 0.5);
    return {
      p1Bar,
      p2Bar,
      status: this.add.text(580, 82, 'FIGHT', { fontSize: '26px', color: '#fff' })
    };
  }

  update(_time, _delta) {
    if (this.fighters.p1.isKO || this.fighters.p2.isKO) {
      const winner = this.fighters.p1.isKO ? this.enemyCharacter : this.playerCharacter;
      this.scene.start('Result', { winner, playerCharacter: this.playerCharacter, enemyCharacter: this.enemyCharacter });
      return;
    }

    this.handlePlayerInput();

    tickFighter(this.fighters.p1);
    tickFighter(this.fighters.p2);

    this.rigs.p1.x = this.fighters.p1.x;
    this.rigs.p2.x = this.fighters.p2.x;

    this.ui.p1Bar.width = 3.2 * this.fighters.p1.health;
    this.ui.p2Bar.width = 3.2 * this.fighters.p2.health;
  }

  handlePlayerInput() {
    if (this.keys.left.isDown) {
      this.fighters.p1.vx = -8;
      this.fighters.p1.facing = -1;
    }
    if (this.keys.right.isDown) {
      this.fighters.p1.vx = 8;
      this.fighters.p1.facing = 1;
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.dash)) {
      applyBoostDash(this.fighters.p1, this.fighters.p1.facing, Date.now());
      this.socket?.emit('input:action', { type: 'BOOST_DASH', direction: this.fighters.p1.facing });
    }

    this.tryAction(this.keys.mainAttack, 'MAIN_ATTACK');
    this.tryAction(this.keys.subAttack, 'SUB_ATTACK');
    this.tryAction(this.keys.spAttack, 'SP_ATTACK');
    this.tryAction(this.keys.mainMelee, 'MAIN_MELEE');
    this.tryAction(this.keys.subMelee, 'SUB_MELEE');
    this.tryAction(this.keys.spMelee, 'SP_MELEE');
  }

  tryAction(key, actionType) {
    if (!Phaser.Input.Keyboard.JustDown(key)) return;

    const result = resolveAction(this.fighters.p1, this.fighters.p2, actionType, Date.now());
    if (this.socket) this.socket.emit('input:action', { type: actionType });

    if (result.applied) {
      this.flash(this.rigs.p2, 0xff3344);
      this.ui.status.setText(`${MOVE_SET[actionType].name}! -${result.damage}`);
    } else {
      this.ui.status.setText(result.whiff ? `${MOVE_SET[actionType].name} missed` : 'Cooling down');
    }
  }

  botThink() {
    if (this.mode !== 'bot' || this.fighters.p2.isKO) return;

    const dx = this.fighters.p1.x - this.fighters.p2.x;
    this.fighters.p2.facing = dx >= 0 ? 1 : -1;

    if (Math.abs(dx) > 80) {
      this.fighters.p2.vx = this.fighters.p2.facing * 7;
      return;
    }

    const actions = ['MAIN_ATTACK', 'SUB_ATTACK', 'MAIN_MELEE', 'SP_ATTACK'];
    const choice = Phaser.Utils.Array.GetRandom(actions);
    const result = resolveAction(this.fighters.p2, this.fighters.p1, choice, Date.now());
    if (result.applied) {
      this.flash(this.rigs.p1, 0xff3344);
      this.ui.status.setText(`BOT ${MOVE_SET[choice].name}`);
    }
  }

  flash(target, tint) {
    target.list[0].clear();
    target.list[0].lineStyle(7, tint);
    target.list[0].strokeCircle(0, -90, 28);
    target.list[0].strokeRect(-28, -55, 56, 85);
    target.list[0].strokeRect(-50, 38, 36, 14);
    target.list[0].strokeRect(14, 38, 36, 14);
    target.list[0].strokeRect(-88, -33, 58, 12);
    target.list[0].strokeRect(30, -33, 58, 12);

    this.time.delayedCall(100, () => {
      target.list[0].clear();
      target.list[0].lineStyle(5, target === this.rigs.p1 ? this.playerCharacter.color : this.enemyCharacter.color);
      target.list[0].strokeCircle(0, -90, 28);
      target.list[0].strokeRect(-28, -55, 56, 85);
      target.list[0].strokeRect(-50, 38, 36, 14);
      target.list[0].strokeRect(14, 38, 36, 14);
      target.list[0].strokeRect(-88, -33, 58, 12);
      target.list[0].strokeRect(30, -33, 58, 12);
    });
  }
}
