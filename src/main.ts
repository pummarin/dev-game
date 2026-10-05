import Phaser from 'phaser';
import './style.css';

class WalkScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private grid!: Phaser.GameObjects.Graphics;
  private keys!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private readonly speed = 220;

  constructor() {
    super('walk');
  }

  preload() {
    this.load.image('power-tracker', '/assets/power-tracker.png');
  }

  create() {
    this.grid = this.add.graphics().setDepth(0);
    this.drawGrid(this.scale.width, this.scale.height);

    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard input is unavailable');
    this.keys = kb.addKeys('W,A,S,D') as typeof this.keys;
    kb.on('keydown', (event: KeyboardEvent) => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) event.preventDefault();
    });
    this.game.canvas.addEventListener('pointerdown', () => this.game.canvas.focus());
    this.game.canvas.addEventListener('blur', () => kb.resetKeys());
    this.game.canvas.tabIndex = 0;
    this.game.canvas.focus();

    this.player = this.add.image(this.scale.width / 2, this.scale.height / 2, 'power-tracker')
      .setOrigin(0.5, 0.5)
      .setDepth(1)
      .setDisplaySize(92, 138);

    this.add.text(18, 16, 'ทดลองเดิน  ·  W A S D', {
      fontFamily: 'system-ui, sans-serif', fontSize: '16px', color: '#f3f1df',
      backgroundColor: '#17221dcc', padding: { x: 12, y: 8 },
    }).setScrollFactor(0).setDepth(2);

    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.drawGrid(size.width, size.height);
      this.clampPlayer(size.width, size.height);
    });
  }

  update(_time: number, delta: number) {
    const x = Number(this.keys.D.isDown) - Number(this.keys.A.isDown);
    const y = Number(this.keys.S.isDown) - Number(this.keys.W.isDown);
    const length = Math.hypot(x, y);
    if (!length) return;

    const step = Math.min(delta, 50) / 1000 * this.speed;
    this.player.x += x / length * step;
    this.player.y += y / length * step;
    this.clampPlayer(this.scale.width, this.scale.height);
  }

  private clampPlayer(width: number, height: number) {
    const halfW = this.player.displayWidth / 2;
    const halfH = this.player.displayHeight / 2;
    this.player.x = Phaser.Math.Clamp(this.player.x, halfW, Math.max(halfW, width - halfW));
    this.player.y = Phaser.Math.Clamp(this.player.y, halfH, Math.max(halfH, height - halfH));
  }

  private drawGrid(width: number, height: number) {
    this.grid.clear();
    this.grid.fillStyle(0x536852, 1).fillRect(0, 0, width, height);
    this.grid.lineStyle(1, 0x75856d, 0.24);
    const gap = 48;
    for (let x = 0; x <= width; x += gap) this.grid.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += gap) this.grid.lineBetween(0, y, width, y);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#536852',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  render: { antialias: true, pixelArt: false },
  scene: WalkScene,
});
