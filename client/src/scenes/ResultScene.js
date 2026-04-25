export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  init(data) {
    this.winner = data.winner;
    this.playerCharacter = data.playerCharacter;
    this.enemyCharacter = data.enemyCharacter;
  }

  create() {
    this.add.rectangle(640, 360, 1280, 720, 0x090d24);
    this.add.text(640, 220, 'MATCH END', { fontSize: '52px', color: '#95dfff' }).setOrigin(0.5);
    this.add.text(640, 320, `${this.winner.name} Wins`, { fontSize: '64px', color: '#ffffff' }).setOrigin(0.5);
    this.add.text(640, 390, 'Press ENTER to rematch\nPress ESC to character select', {
      align: 'center',
      fontSize: '26px',
      color: '#b8c9ff'
    }).setOrigin(0.5);

    const enter = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    const esc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    enter.once('down', () => {
      this.scene.start('Fight', {
        playerCharacter: this.playerCharacter,
        enemyCharacter: this.enemyCharacter,
        mode: 'bot'
      });
    });
    esc.once('down', () => this.scene.start('CharacterSelect'));
  }
}
