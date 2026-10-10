import Phaser from 'phaser';
import { preloadTraveler, registerTravelerAnimations, TravelerController } from './traveler-controller';
import { MapTransitionRouter } from './map-transitions';
import type { MapExitDefinition } from './map-transitions';
import { reportGameReady, reportLoadingError, reportLoadingProgress } from './loading-screen';
import { FrontierTownHud } from './game-hud';
import { CHARACTER_POINTS_PER_LEVEL, CharacterStatus } from './character-status';
import { MonsterHub, MONSTER_TEXTURES } from './monsters/monster-hub';

type TownLayout = {
  id: string;
  widthH: number;
  heightH: number;
  pixelsPerH: number;
  spawnH: [number, number];
  plazaH: { center: [number, number]; size: [number, number] };
  roadRingH: { center: [number, number]; innerRadii: [number, number]; outerRadii: [number, number] };
  warpGateH: [number, number];
  exits: MapExitDefinition[];
};

type AssetMetric = { image: [number, number]; visible: [number, number]; anchor: [number, number] };
type PlacedAsset = { file: string; x: number; y: number; box: [number, number]; layer?: 'base' | 'behind' | 'canopy' };
type MapCollider = { x: number; y: number; width: number; height: number };

const MAP_ROOT = '/assets/maps/frontier-town-v2/';

// ── Scale reference ────────────────────────────────────────────────────────
// C = visible character height in world pixels, measured from S-run frame 0
// alpha bounds: visible_h = 1177px in a 1254px canvas, displayed at 110px
// → C = 1177 * (110/1254) ≈ 103px
// 1H = 1C = 103px   map = 30×20H = 3090×2060 world px

// ── Metrics for new chibi-style assets ────────────────────────────────────
// image:   full PNG canvas [w, h]
// visible: alpha-bounded content [w, h]
// anchor:  base-centre pixel within full image [x, y]  (bottom of visible area, horizontal centre)
const METRICS: Record<string, AssetMetric> = {
  'tavern.png':      { image: [1402, 1122], visible: [1358, 1038], anchor: [710, 1067] },
  'shop.png':        { image: [1374, 1145], visible: [1267, 1021], anchor: [714, 1095] },
  'blacksmith.png':  { image: [840,  700],  visible: [788,  628],  anchor: [423, 654]  },
  'gatehouse.png':   { image: [1254, 1254], visible: [1235, 986],  anchor: [627, 1107] },
  'fountain.png':    { image: [440,  440],  visible: [440,  437],  anchor: [219, 439]  },
  'tree.png':        { image: [1536, 1024], visible: [1152, 968],  anchor: [767, 990]  },
  'bush-flower.png': { image: [1536, 1024], visible: [1386, 677],  anchor: [780, 866]  },
};

// ── Placed assets ─────────────────────────────────────────────────────────
// Coordinate system: 1H = 1C = 103px  (C = visible character height)
// map 30×20H = 3090×2060 world px
//
// All box sizes are in H/C units — box=[widthC, heightC] of visible content
//
// Town layout (origin top-left):
//   Fountain     (15, 10)  — town centre / plaza
//   Player spawn (15, 13)  — 3C south of fountain, clear start view
//   Tavern       (15,  5)  — 5C north of fountain
//   Shop         (20,  9)  — east of plaza
//   Blacksmith   (10,  9)  — west of plaza
//   Gatehouse    (27,  3)  — NE exit
//   Trees        — perimeter, 4–6C from buildings
//   Bushes       — accent clusters near buildings
const ASSETS: PlacedAsset[] = [
  // ── Structures ───────────────────────────────────────────────────────────
  // box target: ~3C wide × 2.5C tall for main buildings
  { file: 'tavern.png',     x: 15, y:  5, box: [3.0, 2.5] },
  { file: 'shop.png',       x: 20, y:  9, box: [3.0, 2.5] },
  { file: 'blacksmith.png', x: 10, y:  9, box: [2.5, 2.0] },
  { file: 'gatehouse.png',  x: 27, y:  3, box: [3.0, 3.0] },
  // ── Plaza prop ───────────────────────────────────────────────────────────
  // Fountain ~1.4C wide
  { file: 'fountain.png',   x: 15, y: 10, box: [1.4, 1.4] },
  // ── Trees — perimeter ────────────────────────────────────────────────────
  // ~2.5C wide, 3C tall
  { file: 'tree.png', x:  3, y:  3, box: [2.5, 3.0] },
  { file: 'tree.png', x:  7, y:  2, box: [2.5, 3.0] },
  { file: 'tree.png', x: 22, y:  2, box: [2.5, 3.0] },
  { file: 'tree.png', x:  2, y: 13, box: [2.5, 3.0] },
  { file: 'tree.png', x:  8, y: 17, box: [2.5, 3.0] },
  { file: 'tree.png', x: 22, y: 17, box: [2.5, 3.0] },
  { file: 'tree.png', x: 28, y: 14, box: [2.5, 3.0] },
  // ── Bush/flower accents ───────────────────────────────────────────────────
  // ~2C wide, 1C tall
  { file: 'bush-flower.png', x: 12, y:  6, box: [2.0, 1.0] },
  { file: 'bush-flower.png', x: 18, y:  6, box: [2.0, 1.0] },
  { file: 'bush-flower.png', x:  5, y: 15, box: [2.0, 1.0] },
  { file: 'bush-flower.png', x: 25, y: 15, box: [2.0, 1.0] },
];

// ── Road paths (H/C coordinates) ──────────────────────────────────────────
// Road width ~1.3C rendered via isRoadCell with threshold 0.65
const ROAD_PATHS: Array<Array<[number, number]>> = [
  // N spur: fountain → tavern
  [[15, 8.5], [15, 5.5]],
  // E spur: fountain → shop
  [[16.8, 10], [20, 9.5]],
  // W spur: fountain → blacksmith
  [[13.2, 10], [10, 9.5]],
  // NE exit road: ring → gatehouse
  [[18, 8], [22, 5], [25, 3.5], [27, 3.5]],
  // S path: fountain → spawn area
  [[15, 11.5], [15, 14]],
];

export class FrontierTownScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private traveler!: TravelerController;
  private hud!: FrontierTownHud;
  private monsterHub!: MonsterHub;
  private readonly characterStatus = new CharacterStatus();
  private unsubscribeMovementSpeed?: () => void;
  private unsubscribeLevelUp?: () => void;
  private transitionRouter!: MapTransitionRouter;
  private readonly mapColliders: MapCollider[] = [];
  private layout!: TownLayout;
  private worldWidth = 0;
  private worldHeight = 0;
  private unit = 0;
  // idle-sheet cell = 627×627, originY from pixel measurement (foot at y=590/626)
  private readonly spriteSize = 103;
  private readonly spriteOriginX = 0.5;
  private readonly spriteOriginY = 0.942;

  constructor() {
    super('frontier-town');
  }

  preload() {
    reportLoadingProgress(0, 'กำลังเตรียมแผนที่…');
    this.load.on('progress', (progress: number) => {
      reportLoadingProgress(progress, progress < 0.35 ? 'กำลังโหลดภาพเมือง…' : 'กำลังเตรียมตัวละคร…');
    });
    this.load.json('town-layout', `${MAP_ROOT}layout.json`);
    this.load.image('item-icons', '/assets/items/item-icons.png');
    // Ground tiles
    this.load.image('map-grass',  `${MAP_ROOT}grass-tile.png`);
    this.load.image('map-plaza',  `${MAP_ROOT}plaza-tile.png`);
    // Road: use frame 0 of the path tileset (top-left 314×314 crop = plain dirt path tile)
    this.load.spritesheet('path-tileset', `${MAP_ROOT}path-tileset.png`, {
      frameWidth: 313, frameHeight: 313,
    });
    // Structures & props
    for (const key of Object.keys(METRICS)) {
      this.load.image(key, `${MAP_ROOT}${key}`);
    }
    preloadTraveler(this);
    for (const texture of MONSTER_TEXTURES) this.load.image(texture.key, texture.url);
    this.load.image('ui-icon-status',   '/assets/ui/icon-status.svg');
    this.load.image('ui-icon-bag',      '/assets/ui/icon-bag.svg');
    this.load.image('ui-icon-map',      '/assets/ui/icon-map.svg');
    this.load.image('ui-icon-settings', '/assets/ui/icon-settings.svg');
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.error(`Failed to load ${file.key}: ${file.src}`);
      reportLoadingError(`โหลดไฟล์ ${file.key} ไม่สำเร็จ`);
    });
  }

  create() {
    registerTravelerAnimations(this);
    this.registerItemIconFrames();
    // Register road tile from the path tileset spritesheet (frame 0 = top-left plain dirt)
    if (!this.textures.exists('map-road')) {
      const tex = this.textures.get('path-tileset');
      const frames = tex.frames as Record<string, Phaser.Textures.Frame>;
      const frame = frames['0'];
      const c = document.createElement('canvas');
      c.width = frame.realWidth; c.height = frame.realHeight;
      const ctx = c.getContext('2d')!;
      const src = tex.getSourceImage() as HTMLImageElement;
      ctx.drawImage(src, frame.cutX, frame.cutY, frame.realWidth, frame.realHeight, 0, 0, frame.realWidth, frame.realHeight);
      this.textures.addCanvas('map-road', c);
    }
    this.layout = this.cache.json.get('town-layout') as TownLayout;
    this.unit = this.layout.pixelsPerH;
    this.worldWidth = this.layout.widthH * this.unit;
    this.worldHeight = this.layout.heightH * this.unit;
    this.drawGroundAndPaths();
    this.mapColliders.length = 0;
    this.placeTownAssets();
    this.transitionRouter = new MapTransitionRouter(this);
    this.setupPlayerAndCamera();
    this.hud = new FrontierTownHud(this, this.player, {
      widthH: this.layout.widthH,
      heightH: this.layout.heightH,
      pixelsPerH: this.unit,
      gateH: this.layout.warpGateH,
      roadRingH: { center: this.layout.roadRingH.center, outerRadii: this.layout.roadRingH.outerRadii },
      roadPathsH: ROAD_PATHS,
      riverTilesH: [],
    }, this.characterStatus);
    this.monsterHub = new MonsterHub(
      this, this.layout.id, this.unit, this.player, this.traveler, this.characterStatus,
      (items) => this.hud.setInventoryContents(items),
      (items) => this.hud.setEquipmentContents(items),
      (amount) => this.hud.setCurrencyAmount(amount),
      (message) => this.hud.setGameMessage(message),
      (x, y) => this.hud.blocksWorldPointer(x, y),
    );
    this.hud.setInventoryActions(
      (itemId, amount) => this.monsterHub.dropInventoryItem(itemId, amount),
      (itemId) => this.monsterHub.useInventoryItem(itemId),
      (itemId) => this.monsterHub.equipInventoryItem(itemId),
      (slot) => this.monsterHub.unequipEquipmentSlot(slot),
    );
    let previousLevel = this.characterStatus.snapshot().level;
    this.unsubscribeLevelUp = this.characterStatus.subscribe((snapshot) => {
      if (snapshot.level > previousLevel) {
        const levelsGained = snapshot.level - previousLevel;
        this.hud.showLevelUp(previousLevel, snapshot.level, levelsGained * CHARACTER_POINTS_PER_LEVEL);
      }
      previousLevel = snapshot.level;
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribeLevelUp?.());
    reportGameReady();
  }

  private registerItemIconFrames() {
    const texture = this.textures.get('item-icons');
    const image = texture.getSourceImage() as HTMLImageElement;
    const columns = 4;
    const rows = 4;
    for (let index = 0; index < 11; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = Math.round(column * image.width / columns);
      const y = Math.round(row * image.height / rows);
      const right = Math.round((column + 1) * image.width / columns);
      const bottom = Math.round((row + 1) * image.height / rows);
      const frameKey = String(index);
      if (!texture.has(frameKey)) texture.add(frameKey, 0, x, y, right - x, bottom - y);
    }
  }

  update(_time: number, delta: number) {
    this.updateCameraOffset();
    this.traveler.update(delta);
    this.monsterHub.update(this.time.now);
    const exitResult = this.transitionRouter.update(
      [this.player.x / this.unit, this.player.y / this.unit], this.layout.exits ?? [],
    );
    this.hud.showMissingDestination(exitResult === 'destination-missing');
    this.hud.update();
  }

  /** Add EXP from future quest, exploration, or combat systems. */
  grantExperience(amount: number) {
    return this.characterStatus.grantExperience(amount);
  }

  private drawGroundAndPaths() {
    // Grass tile 440×440 → target 2C×2C = 206px square → scale = 206/440
    const grassScale = (2 * this.unit) / 440;
    this.add.tileSprite(0, 0, this.worldWidth, this.worldHeight, 'map-grass')
      .setOrigin(0).setTileScale(grassScale).setDepth(0);

    // Plaza stone: 5C×4C centred on fountain
    const [plazaW, plazaH] = this.layout.plazaH.size;
    const plazaScale = (1.5 * this.unit) / 440;
    this.add.tileSprite(
      (this.layout.plazaH.center[0] - plazaW / 2) * this.unit,
      (this.layout.plazaH.center[1] - plazaH / 2) * this.unit,
      plazaW * this.unit, plazaH * this.unit, 'map-plaza',
    ).setOrigin(0).setTileScale(plazaScale).setDepth(0.2);

    // Dirt road tiles — paint each 1C cell that lies on a road path or ring
    for (let row = 0; row < this.layout.heightH; row++) {
      for (let col = 0; col < this.layout.widthH; col++) {
        if (this.isRoadCell(col + 0.5, row + 0.5)) {
          this.add.tileSprite(col * this.unit, row * this.unit, this.unit, this.unit, 'map-road')
            .setOrigin(0).setTileScale(this.unit / 313).setDepth(0.3);
        }
      }
    }
  }

  private isRoadCell(x: number, y: number) {
    const ring = this.layout.roadRingH;
    const dx = x - ring.center[0], dy = y - ring.center[1];
    const outer = (dx / ring.outerRadii[0]) ** 2 + (dy / ring.outerRadii[1]) ** 2;
    const inner = (dx / ring.innerRadii[0]) ** 2 + (dy / ring.innerRadii[1]) ** 2;
    if (outer <= 1 && inner >= 1) return true;
    // Road spur width ~0.65H each side = 1.3C total
    for (const path of ROAD_PATHS) {
      for (let i = 0; i < path.length - 1; i++) {
        if (this.distanceToSegment([x, y], path[i], path[i + 1]) <= 0.65) return true;
      }
    }
    return false;
  }

  private distanceToSegment(point: [number, number], a: [number, number], b: [number, number]) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const lengthSquared = vx * vx + vy * vy;
    const t = lengthSquared === 0 ? 0 : Phaser.Math.Clamp(((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / lengthSquared, 0, 1);
    return Math.hypot(point[0] - (a[0] + t * vx), point[1] - (a[1] + t * vy));
  }

  private placeTownAssets() {
    for (const asset of ASSETS) this.placeAsset(asset);
  }

  private placeAsset(asset: PlacedAsset) {
    const metric = METRICS[asset.file];
    const sprite = this.add.image(asset.x * this.unit, asset.y * this.unit, asset.file);
    const fitW = asset.box[0] * this.unit / metric.visible[0];
    const fitH = asset.box[1] * this.unit / metric.visible[1];
    sprite.setScale(Math.min(fitW, fitH));
    sprite.setOrigin(metric.anchor[0] / metric.image[0], metric.anchor[1] / metric.image[1]);
    const baseDepth = 1 + asset.y * this.unit;
    // Trees use depth based on their base Y so players can walk behind them
    const isTree = asset.file === 'tree.png';
    const isBehind = asset.layer === 'behind';
    sprite.setDepth(isBehind ? baseDepth : isTree ? baseDepth + 0.5 : baseDepth + 1);

    // Fountain shimmer tween
    if (asset.file === 'fountain.png') {
      this.tweens.add({
        targets: sprite,
        alpha: { from: 0.88, to: 1 },
        duration: 600,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });
    }

    if (this.blocksWalking(asset)) {
      const visibleWidth = metric.visible[0] * sprite.scaleX;
      const isStructure = ['tavern.png', 'shop.png', 'blacksmith.png', 'gatehouse.png'].includes(asset.file);
      const bandFraction = isStructure ? 0.52 : 0.30;
      const widthFactor  = isStructure ? 0.78 : 0.70;
      const colliderHeight = Math.min(metric.visible[1] * sprite.scaleY, bandFraction * this.unit);
      const colliderWidth  = visibleWidth * widthFactor;
      this.mapColliders.push({
        x: asset.x * this.unit - colliderWidth / 2,
        y: asset.y * this.unit - colliderHeight,
        width: colliderWidth,
        height: colliderHeight,
      });
    }
  }

  private blocksWalking(asset: PlacedAsset) {
    if (asset.layer === 'canopy' || asset.layer === 'behind') return false;
    // Decorative props that the player can walk through
    const passThrough = ['bush-flower.png', 'fountain.png'];
    return !passThrough.includes(asset.file);
  }

  private setupPlayerAndCamera() {
    const spawnX = this.layout.spawnH[0] * this.unit;
    const spawnY = this.layout.spawnH[1] * this.unit;
    // Use idle-sheet frame 0 (SOUTH) as starting pose
    this.player = this.add.sprite(spawnX, spawnY, 'idle-sheet', 0)
      .setOrigin(this.spriteOriginX, this.spriteOriginY)
      .setDisplaySize(this.spriteSize, this.spriteSize);
    this.updatePlayerDepth();
    this.traveler = new TravelerController(this, this.player, {
      mapWidth: this.worldWidth,
      mapHeight: this.worldHeight,
      colliders: this.mapColliders,
    });
    this.unsubscribeMovementSpeed = this.characterStatus.subscribe(({ derived }) => this.traveler.setSpeed(derived.movementSpeed));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribeMovementSpeed?.());
    const camera = this.cameras.main;
    camera.setBounds(0, 0, this.worldWidth, this.worldHeight);
    camera.setZoom(1);
    camera.setRoundPixels(false);
    camera.startFollow(this.player, true, 0.12, 0.12, 0, this.unit);
    camera.centerOn(spawnX, spawnY);
    this.updateCameraOffset();
    const onResize = () => {
      this.traveler.clampToMap();
      this.hud?.resize(this.scale.width, this.scale.height);
    };
    this.scale.on('resize', onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', onResize));
  }

  private updateCameraOffset() {
    const gateX = this.layout.warpGateH[0];
    const gateY = this.layout.warpGateH[1];
    const dx = this.player.x / this.unit - gateX;
    const dy = this.player.y / this.unit - gateY;
    const nearGate = dx * dx + dy * dy <= 4 * 4;
    this.cameras.main.setFollowOffset(nearGate ? -0.95 * this.unit : 0, this.unit);
  }

  private updatePlayerDepth() { this.player.setDepth(1 + this.player.y); }

}
