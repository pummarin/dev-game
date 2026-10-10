import Phaser from 'phaser';

export const TRAVELER_IDLE_KEY = 'traveler-idle';
export const TRAVELER_IDLE_PATH = '/assets/frontier-traveler-idle-prototype.png';

const RUN_DIRECTIONS = ['S', 'SW', 'W', 'NW', 'N'] as const;
const ATTACK_DIRECTIONS = ['S', 'W', 'N'] as const;
const FRAME_SIZE = 1254;
const FRAME_COUNT = 7;
const ATTACK_FRAME_COUNT = 4;
const ATTACK_FRAME_SIZE: Record<(typeof ATTACK_DIRECTIONS)[number], number> = {
  S: 627,
  W: 627,
  N: 627,
};

type Direction = 'S' | 'SW' | 'W' | 'NW' | 'N' | 'SE' | 'E' | 'NE';
type MovementKeys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

export type TravelerControllerOptions = {
  mapWidth: number;
  mapHeight: number;
  speed?: number;
  colliders?: Array<{ x: number; y: number; width: number; height: number }>;
};

/** Load shared character textures in each playable map scene's preload(). */
export function preloadTraveler(scene: Phaser.Scene) {
  scene.load.image(TRAVELER_IDLE_KEY, TRAVELER_IDLE_PATH);
  for (const direction of RUN_DIRECTIONS) {
    scene.load.spritesheet(`run-sheet-${direction}`, `/assets/traveler-run-5dir/traveler-${direction}-run-7.png`, {
      frameWidth: FRAME_SIZE,
      frameHeight: FRAME_SIZE,
      margin: 0,
      spacing: 0,
    });
  }
  for (const direction of ATTACK_DIRECTIONS) {
    const frameSize = ATTACK_FRAME_SIZE[direction];
    const attackPath = direction === 'W'
      ? '/assets/attacks/traveler-attack-W-normalized.png'
      : `/assets/attacks/traveler-attack-${direction}.png`;
    scene.load.spritesheet(`attack-sheet-${direction}`, attackPath, {
      frameWidth: frameSize,
      frameHeight: frameSize,
      margin: 0,
      spacing: 0,
    });
  }
}

/** Register the shared run animations once per Phaser game, after preload completes. */
export function registerTravelerAnimations(scene: Phaser.Scene) {
  for (const direction of RUN_DIRECTIONS) {
    const key = `run-${direction}`;
    if (!scene.anims.exists(key)) {
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(`run-sheet-${direction}`, { start: 0, end: FRAME_COUNT - 1 }),
        frameRate: 10,
        repeat: -1,
      });
    }
  }
  for (const direction of ATTACK_DIRECTIONS) {
    const attackKey = `attack-${direction}`;
    if (!scene.anims.exists(attackKey)) {
      scene.anims.create({
        key: attackKey,
        frames: scene.anims.generateFrameNumbers(`attack-sheet-${direction}`, { start: 0, end: ATTACK_FRAME_COUNT - 1 }),
        frameRate: 10,
        repeat: 0,
      });
    }
  }
}

/** Map-independent WASD movement and eight-way run animation for a map's traveler sprite. */
export class TravelerController {
  private readonly keys: MovementKeys;
  private speed: number;
  private inputFocused = true;
  private currentDirection: Direction | null = null;
  private lastDirection: Direction = 'S';
  private currentAnimationKey: string | null = null;
  private attacking = false;
  private attackHitTimer?: Phaser.Time.TimerEvent;
  private readonly baseDisplayWidth: number;
  private readonly baseDisplayHeight: number;
  private readonly baseOriginX: number;
  private readonly baseOriginY: number;
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
    this.baseOriginX = sprite.originX;
    this.baseOriginY = sprite.originY;

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
    this.lastDirection = direction;
    // Set this on every update so a mirrored direction alias switches immediately,
    // even when it shares the same base animation key (for example W ↔ E).
    this.sprite.setFlipX(direction === 'E' || direction === 'NE' || direction === 'SE');
    const animationKey = this.getAnimationKey(direction);
    if (!this.scene.anims.exists(animationKey)) {
      console.error(`Traveler animation is not registered: ${animationKey}`);
      this.enterIdle();
      return;
    }
    if (this.currentAnimationKey !== animationKey) {
      this.sprite.play(animationKey);
      this.sprite.setDisplaySize(this.baseDisplayWidth, this.baseDisplayHeight);
      this.currentAnimationKey = animationKey;
    }
    this.currentDirection = direction;
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

  /** Plays one direction-matched sword swing; the impact callback fires on the slash beat. */
  playAttack(onImpact?: () => void, targetPosition?: { x: number; y: number }) {
    if (this.attacking) return false;
    const facing = targetPosition
      ? this.getAttackDirection(targetPosition.x - this.sprite.x, targetPosition.y - this.sprite.y)
      : this.getAttackDirectionForFacing(this.currentDirection ?? this.lastDirection);
    const animationKey = this.getAttackAnimationKey(facing);
    if (!this.scene.anims.exists(animationKey)) {
      console.error(`Traveler attack animation is not registered: ${animationKey}`);
      return false;
    }

    this.sprite.anims.stop();
    this.sprite.setFlipX(facing === 'E');
    this.sprite.play(animationKey);
    this.sprite.setDisplaySize(this.baseDisplayWidth, this.baseDisplayHeight);
    this.currentAnimationKey = animationKey;
    this.currentDirection = facing;
    this.lastDirection = facing;
    this.attacking = true;
    this.attackHitTimer?.remove(false);
    this.attackHitTimer = this.scene.time.delayedCall(100, () => {
      if (this.attacking) onImpact?.();
    });
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onAttackComplete, this);
    return true;
  }

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
    return (this.options.colliders ?? []).some((collider) =>
      body.left < collider.x + collider.width &&
      body.right > collider.x &&
      body.top < collider.y + collider.height &&
      body.bottom > collider.y,
    );
  }

  private getDirection(x: number, y: number): Direction {
    if (x === 0) return y < 0 ? 'N' : 'S';
    if (y === 0) return x < 0 ? 'W' : 'E';
    if (x < 0) return y < 0 ? 'NW' : 'SW';
    return y < 0 ? 'NE' : 'SE';
  }

  private getAnimationKey(direction: Direction) {
    return `run-${this.getBaseDirection(direction)}`;
  }

  private getAttackAnimationKey(direction: 'N' | 'S' | 'W' | 'E') {
    return `attack-${direction === 'E' ? 'W' : direction}`;
  }

  private getAttackDirection(x: number, y: number): 'N' | 'S' | 'W' | 'E' {
    if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'W' : 'E';
    return y < 0 ? 'N' : 'S';
  }

  private getAttackDirectionForFacing(direction: Direction): 'N' | 'S' | 'W' | 'E' {
    const vectors: Record<Direction, [number, number]> = {
      N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0],
      NW: [-1, -1], NE: [1, -1], SW: [-1, 1], SE: [1, 1],
    };
    const [x, y] = vectors[direction];
    return this.getAttackDirection(x, y);
  }

  private getBaseDirection(direction: Direction): (typeof RUN_DIRECTIONS)[number] {
    return direction === 'E' ? 'W' : direction === 'NE' ? 'NW' : direction === 'SE' ? 'SW' : direction;
  }

  private readonly onAttackComplete = (animation: Phaser.Animations.Animation) => {
    if (!this.attacking || animation.key !== this.currentAnimationKey) return;
    this.attacking = false;
    this.attackHitTimer?.remove(false);
    this.attackHitTimer = undefined;
    this.currentAnimationKey = null;
    this.sprite.setOrigin(this.baseOriginX, this.baseOriginY);
    this.sprite.setDisplaySize(this.baseDisplayWidth, this.baseDisplayHeight);
  };

  private cancelAttack() {
    if (!this.attacking) return;
    this.attacking = false;
    this.attackHitTimer?.remove(false);
    this.attackHitTimer = undefined;
    this.sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onAttackComplete, this);
    this.sprite.anims.stop();
    this.currentAnimationKey = null;
    this.sprite.setOrigin(this.baseOriginX, this.baseOriginY);
    this.sprite.setDisplaySize(this.baseDisplayWidth, this.baseDisplayHeight);
  }

  private enterIdle() {
    if (this.currentAnimationKey === null && this.currentDirection === null) return;
    this.cancelAttack();
    this.sprite.anims.stop();
    this.sprite.setTexture(TRAVELER_IDLE_KEY).setFlipX(false)
      .setOrigin(this.baseOriginX, this.baseOriginY)
      .setDisplaySize(this.baseDisplayWidth, this.baseDisplayHeight);
    this.currentDirection = null;
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
