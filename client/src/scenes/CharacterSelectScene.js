const CHARACTERS = [
  {
    id: 'nova',
    name: 'Nova Striker',
    color: 0x00f0ff,
    modules: { head: [], body: [], feet: [], leftArm: [], rightArm: [] }
  },
  {
    id: 'aegis',
    name: 'Aegis Brawler',
    color: 0xff48f5,
    modules: { head: [], body: [], feet: [], leftArm: [], rightArm: [] }
  }
];

export class CharacterSelectScene extends Phaser.Scene {
  constructor() {
    super('CharacterSelect');
  }

  create() {
    this.add.text(640, 80, 'NEON GVG 1V1', { fontSize: '54px', color: '#80ffff' }).setOrigin(0.5);
    this.add.text(640, 130, 'Select your fighter (client-side battle)', {
      fontSize: '20px',
      color: '#c6d8ff'
    }).setOrigin(0.5);

    CHARACTERS.forEach((fighter, index) => {
      const x = 380 + index * 520;
      const panel = this.add.rectangle(x, 360, 380, 460, 0x10173a, 0.8).setStrokeStyle(2, fighter.color);
      panel.setInteractive({ useHandCursor: true });

      this.drawRig(x, 300, fighter.color);
      this.add.text(x, 520, fighter.name, { fontSize: '32px', color: '#fff' }).setOrigin(0.5);
      this.add.text(x, 570, 'Head / Body / Feet / 2 Arms\nExpandable module slots ready', {
        fontSize: '17px',
        align: 'center',
        color: '#9ec8ff'
      }).setOrigin(0.5);

      panel.on('pointerdown', () => {
        this.scene.start('Fight', { playerCharacter: fighter, enemyCharacter: CHARACTERS[(index + 1) % 2], mode: 'bot' });
      });
    });
  }

  drawRig(x, y, color) {
    const g = this.add.graphics({ lineStyle: { width: 5, color } });
    g.strokeCircle(x, y - 100, 35); // head
    g.strokeRect(x - 30, y - 50, 60, 90); // body
    g.strokeRect(x - 55, y + 48, 40, 15); // feet
    g.strokeRect(x + 15, y + 48, 40, 15);
    g.strokeRect(x - 95, y - 35, 60, 14); // arm L
    g.strokeRect(x + 35, y - 35, 60, 14); // arm R
  }
}
