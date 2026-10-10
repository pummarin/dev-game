import Phaser from 'phaser';

// ── Sprite sheet specs ─────────────────────────────────────────────────────
//
// idle.png   1254×1254 — 2×2 grid, cell 627×627
//   (col,row): S=(0,0)  W=(1,0)  N=(0,1)  E=(1,1)
//
// walk-corrected.png — 6 cols × 4 rows, cell 256×256; W row is mirrored to face left
//   row 0=N  row 1=W  row 2=S  row 3=E
//
// attack-normalized.png — 5 cols × 4 rows, 360×320 frames with transparent padding
//   row 0=N  row 1=E  row 2=S  row 3=W
//   No flip — E and W are drawn separately.

const CHAR_ROOT = '/assets/character/';

// Walk sheet
const WALK_COLS = 6;
const WALK_CELL = 256;
// Row order confirmed from sprite: N=0, W=1, S=2, E=3
const WALK_DIR_ROW: Record<'N' | 'E' | 'S' | 'W', number> = { N: 0, W: 1, S: 2, E: 3 };

// Attack sheet
const ATTACK_COLS = 5;
const ATTACK_SOURCE_CELL = 280;
const ATTACK_FRAME_WIDTH = 360;
const ATTACK_FRAME_HEIGHT = 320;
const ATTACK_PADDING_X = 24;
const ATTACK_PADDING_Y = 24;
// Row order differs from walk sheet: N=0, E=1, S=2, W=3
const ATTACK_DIR_ROW: Record<'N' | 'E' | 'S' | 'W', number> = { N: 0, E: 1, S: 2, W: 3 };

// ── Origin Y per sheet (foot anchor relative to cell height) ─────────────
// Measured from alpha bounds of S-facing frames
const ORIGIN_Y_IDLE = 0.942; // idle sheet 627×627
const ORIGIN_Y_WALK = 0.925; // walk sheet 256×256
const ORIGIN_X = 0.5;          // horizontal centre for all sheets
const ORIGIN_X_ATTACK = (ATTACK_PADDING_X + ORIGIN_X * ATTACK_SOURCE_CELL) / ATTACK_FRAME_WIDTH;
const ORIGIN_Y_ATTACK = (ATTACK_PADDING_Y + 0.918 * ATTACK_SOURCE_CELL) / ATTACK_FRAME_HEIGHT;

// Idle sheet — static frames per direction
const IDLE_CELL = 627;
// Confirmed by pixel analysis (hair/shield position):
// Frame 0=(col0,row0)=S  Frame 1=(col1,row0)=W
// Frame 2=(col0,row1)=N  Frame 3=(col1,row1)=E
const IDLE_DIR_FRAME: Record<'N' | 'E' | 'S' | 'W', number> = { S: 0, W: 1, N: 2, E: 3 };

const CARDINAL_DIRS = ['N', 'E', 'S', 'W'] as const;
type CardinalDir = (typeof CARDINAL_DIRS)[number];
type Direction = 'S' | 'SW' | 'W' | 'NW' | 'N' | 'SE' | 'E' | 'NE';
type MovementKeys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

// Legacy export used by frontier-town-map.ts for portrait image
export const TRAVELER_IDLE_KEY = 'traveler-idle-S';
export const TRAVELER_IDLE_PATH = `${CHAR_ROOT}idle.png`;

export type TravelerControllerOptions = {
  mapWidth: number;
  mapHeight: number;
  speed?: number;
  colliders?: Array<{ x: number; y: number; width: number; height: number }>;
};

/** Load character textures. Call once per scene in preload(). */
export function preloadTraveler(scene: Phaser.Scene) {
  // The original side-facing rows both face right; W is mirrored in the corrected sheet.
  scene.load.spritesheet('walk-sheet', `${CHAR_ROOT}walk-corrected.png`, {
    frameWidth: WALK_CELL,
    frameHeight: WALK_CELL,
  });
  // Isolated attack frames retain sword pixels that crossed the original grid cuts.
  scene.load.spritesheet('attack-sheet', `${CHAR_ROOT}attack-normalized.png`, {
    frameWidth: ATTACK_FRAME_WIDTH,
    frameHeight: ATTACK_FRAME_HEIGHT,
  });
  // Idle sheet — load as spritesheet so we can use individual frames
  scene.load.spritesheet('idle-sheet', `${CHAR_ROOT}idle.png`, {
    frameWidth: IDLE_CELL,
    frameHeight: IDLE_CELL,
  });
}

/** Register walk and attack animations. Call once per scene in create(). */
export function registerTravelerAnimations(scene: Phaser.Scene) {
  for (const dir of CARDINAL_DIRS) {
    const row = WALK_DIR_ROW[dir];
    const walkKey = `walk-${dir}`;
    if (!scene.anims.exists(walkKey)) {
      scene.anims.create({
        key: walkKey,
        frames: scene.anims.generateFrameNumbers('walk-sheet', {
          start: row * WALK_COLS,
          end: row * WALK_COLS + WALK_COLS - 1,
        }),
        frameRate: 10,
        repeat: -1,
      });
    }

    const atkRow = ATTACK_DIR_ROW[dir];
    const atkKey = `attack-${dir}`;
    if (!scene.anims.exists(atkKey)) {
      scene.anims.create({
        key: atkKey,
        frames: scene.anims.generateFrameNumbers('attack-sheet', {
          start: atkRow * ATTACK_COLS,
          end: atkRow * ATTACK_COLS + ATTACK_COLS - 1,
        }),
        frameRate: 10,
        repeat: 0,
      });
    }
  }
}

/** Map-independent WASD movement with 4-directional walk/attack animations. */
export class TravelerController {
  private readonly keys: MovementKeys;
  private speed: number;
  private inputFocused = true;
  private currentDirection: Direction | null = null;
  private lastCardinal: CardinalDir = 'S';
  private currentAnimationKey: string | null = null;
  private attacking = false;
  private attackHitTimer?: Phaser.Time.TimerEvent;
  private readonly baseDisplayWidth: number;
  private readonly baseDisplayHeight: number;
  private readonly canvas: HTMLCanvasElement;
  private moveTarget: { x: number; y: number; arrivalDistance: number } | null = null;

  private readonly onWindowBlur = () => this.clearMovementInput();
  private readonly onWindowFocus = () => { this.inputFocused = true; };
  private readonly onVisibilityChange = () => {
    if (document.hidden) this.clearMovementInput();
    else this.inputFocused = true;
  };
  private readonly onCanvasBlur = () => this.clearMovementInput();
  private readonly onCanvasFocus = () => { this.inputFocused = true; };
  private readonly onCanvasPointerDown = () => this.canvas.focus();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sprite: Phaser.GameObjects.Sprite,
    private readonly options: TravelerControllerOptions,
  ) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input is unavailable');
    this.keys = keyboard.addKeys('W,A,S,D') as MovementKeys;
    this.speed = options.speed ?? 220;
    this.canvas = scene.game.canvas;
    this.baseDisplayWidth = sprite.displayWidth;
    this.baseDisplayHeight = sprite.displayHeight;

    keyboard.on('keydown', this.onKeyDown);
    this.canvas.tabIndex = 0;
    this.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas.addEventListener('focus', this.onCanvasFocus);
    this.canvas.addEventListener('blur', this.onCanvasBlur);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('focus', this.onWindowFocus);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.focus();

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) event.preventDefault();
  };

  update(delta: number) {
    if (!this.inputFocused) { this.enterIdle(); return; }
    let x = Number(this.keys.D.isDown) - Number(this.keys.A.isDown);
    let y = Number(this.keys.S.isDown) - Number(this.keys.W.isDown);
    if (this.attacking) {
      if (x || y) this.cancelAttack();
      else return;
    }
    if (x || y) this.moveTarget = null;
    else if (this.moveTarget) {
      x = this.moveTarget.x - this.sprite.x;
      y = this.moveTarget.y - this.sprite.y;
      if (Math.hypot(x, y) <= this.moveTarget.arrivalDistance) {
        this.moveTarget = null;
        this.enterIdle();
        return;
      }
    }
    const length = Math.hypot(x, y);
    if (!length) { this.enterIdle(); return; }

    const step = Math.min(delta, 50) / 1000 * this.speed;
    this.moveAxis('x', x / length * step);
    this.moveAxis('y', y / length * step);
    this.sprite.setDepth(1 + this.sprite.y);

    const direction = this.getDirection(x, y);
    const cardinal = this.toCardinal(direction);
    this.lastCardinal = cardinal;
    this.currentDirection = direction;

    // No flip — E and W are separate rows
    this.sprite.setFlipX(false);

    const animKey = `walk-${cardinal}`;
    if (!this.scene.anims.exists(animKey)) {
      console.error(`Walk animation not registered: ${animKey}`);
      this.enterIdle();
      return;
    }
    if (this.currentAnimationKey !== animKey) {
      this.sprite.play(animKey);
      this.sprite.setTexture('walk-sheet');
      this.sprite.setOrigin(ORIGIN_X, ORIGIN_Y_WALK);
      this.sprite.setDisplaySize(this.baseDisplayWidth, this.baseDisplayHeight);
      this.currentAnimationKey = animKey;
    }
  }

  destroy() {
    this.cancelAttack();
    this.scene.input.keyboard?.off('keydown', this.onKeyDown);
    this.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas.removeEventListener('focus', this.onCanvasFocus);
    this.canvas.removeEventListener('blur', this.onCanvasBlur);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('focus', this.onWindowFocus);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  clampToMap() {
    const left = this.sprite.originX * this.sprite.displayWidth;
    const right = (1 - this.sprite.originX) * this.sprite.displayWidth;
    const top = this.sprite.originY * this.sprite.displayHeight;
    const bottom = (1 - this.sprite.originY) * this.sprite.displayHeight;
    this.sprite.x = Phaser.Math.Clamp(this.sprite.x, left, Math.max(left, this.options.mapWidth - right));
    this.sprite.y = Phaser.Math.Clamp(this.sprite.y, top, Math.max(top, this.options.mapHeight - bottom));
  }

  setSpeed(speed: number) {
    if (Number.isFinite(speed) && speed > 0) this.speed = speed;
  }

  setMoveTarget(x: number, y: number, arrivalDistance = 12) {
    this.moveTarget = { x, y, arrivalDistance: Math.max(0, arrivalDistance) };
  }

  clearMoveTarget() {
    this.moveTarget = null;
  }

  get hasManualMovementInput() {
    return Boolean(this.keys.W.isDown || this.keys.A.isDown || this.keys.S.isDown || this.keys.D.isDown);
  }

  /** Plays one direction-matched attack; onImpact fires at the strike frame. */
  playAttack(onImpact?: () => void, targetPosition?: { x: number; y: number }) {
    if (this.attacking) return false;
    const cardinal = targetPosition
      ? this.getCardinalFromDelta(targetPosition.x - this.sprite.x, targetPosition.y - this.sprite.y)
      : this.lastCardinal;
    const animKey = `attack-${cardinal}`;
    if (!this.scene.anims.exists(animKey)) {
      console.error(`Attack animation not registered: ${animKey}`);
      return false;
    }

    this.sprite.anims.stop();
    this.sprite.setFlipX(false); // no flip — separate sprites per direction
    this.sprite.play(animKey);
    this.sprite.setOrigin(ORIGIN_X_ATTACK, ORIGIN_Y_ATTACK);
    this.sprite.setDisplaySize(
      this.baseDisplayWidth * ATTACK_FRAME_WIDTH / ATTACK_SOURCE_CELL,
      this.baseDisplayHeight * ATTACK_FRAME_HEIGHT / ATTACK_SOURCE_CELL,
    );
    this.currentAnimationKey = animKey;
    this.currentDirection = cardinal;
    this.lastCardinal = cardinal;
    this.attacking = true;
    this.attackHitTimer?.remove(false);
    this.attackHitTimer = this.scene.time.delayedCall(120, () => {
      if (this.attacking) onImpact?.();
    });
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onAttackComplete, this);
    return true;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private moveAxis(axis: 'x' | 'y', amount: number) {
    const previous = this.sprite[axis];
    this.sprite[axis] += amount;
    this.clampToMap();
    if (this.overlapsCollider()) this.sprite[axis] = previous;
  }

  private overlapsCollider() {
    const bodyWidth = this.sprite.displayWidth * 0.42;
    const bodyHeight = this.sprite.displayHeight * 0.18;
    const body = {
      left: this.sprite.x - bodyWidth / 2,
      right: this.sprite.x + bodyWidth / 2,
      top: this.sprite.y - bodyHeight * 0.65,
      bottom: this.sprite.y + bodyHeight * 0.35,
    };
    return (this.options.colliders ?? []).some((c) =>
      body.left < c.x + c.width && body.right > c.x &&
      body.top < c.y + c.height && body.bottom > c.y,
    );
  }

  private getDirection(x: number, y: number): Direction {
    if (x === 0) return y < 0 ? 'N' : 'S';
    if (y === 0) return x < 0 ? 'W' : 'E';
    if (x < 0) return y < 0 ? 'NW' : 'SW';
    return y < 0 ? 'NE' : 'SE';
  }

  /** Map any 8-way direction to its dominant 4-way cardinal. */
  private toCardinal(direction: Direction): CardinalDir {
    if (direction === 'N' || direction === 'NW' || direction === 'NE') return 'N';
    if (direction === 'S' || direction === 'SW' || direction === 'SE') return 'S';
    if (direction === 'W') return 'W';
    return 'E';
  }

  private getCardinalFromDelta(dx: number, dy: number): CardinalDir {
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'W' : 'E';
    return dy < 0 ? 'N' : 'S';
  }

  /** Show idle frame for the last direction the character faced. */
  private enterIdle() {
    if (this.currentAnimationKey === null && this.currentDirection === null) return;
    this.cancelAttack();
    this.sprite.anims.stop();
    const idleFrame = IDLE_DIR_FRAME[this.lastCardinal];
    this.sprite.setTexture('idle-sheet', idleFrame);
    this.sprite.setFlipX(false);
    this.sprite.setOrigin(ORIGIN_X, ORIGIN_Y_IDLE);
    this.sprite.setDisplaySize(this.baseDisplayWidth, this.baseDisplayHeight);
    this.currentDirection = null;
    this.currentAnimationKey = null;
  }

  private readonly onAttackComplete = (animation: Phaser.Animations.Animation) => {
    if (!this.attacking || animation.key !== this.currentAnimationKey) return;
    this.attacking = false;
    this.attackHitTimer?.remove(false);
    this.attackHitTimer = undefined;
    this.currentAnimationKey = null;
    // Return to idle pose with correct origin
    this.enterIdle();
  };

  private cancelAttack() {
    if (!this.attacking) return;
    this.attacking = false;
    this.attackHitTimer?.remove(false);
    this.attackHitTimer = undefined;
    this.sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onAttackComplete, this);
    this.sprite.anims.stop();
    this.currentAnimationKey = null;
  }

  private clearMovementInput() {
    this.inputFocused = false;
    this.moveTarget = null;
    this.scene.input.keyboard?.resetKeys();
    this.cancelAttack();
    this.enterIdle();
  }
}
