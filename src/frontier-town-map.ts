import Phaser from 'phaser';
import { preloadTraveler, registerTravelerAnimations, TravelerController, TRAVELER_IDLE_KEY } from './traveler-controller';
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

const MAP_ROOT = '/assets/maps/frontier-town-v1/';
const METRICS: Record<string, AssetMetric> = {
  'structures/A01-community-hall.png': { image: [1419, 1108], visible: [1350, 945], anchor: [710, 1008] },
  'structures/A02-house-a.png': { image: [1347, 1167], visible: [1120, 1081], anchor: [688, 1119] },
  'structures/A03-house-b.png': { image: [1360, 1157], visible: [1297, 1029], anchor: [679.5, 1061] },
  'structures/A04-house-c.png': { image: [1347, 1168], visible: [1202, 1051], anchor: [682, 1111] },
  'structures/A05-community-pavilion.png': { image: [1448, 1086], visible: [1310, 1001], anchor: [724, 1031] },
  'structures/A06-workshop.png': { image: [1402, 1122], visible: [1362, 1002], anchor: [701, 1051] },
  'structures/A07-watchpost.png': { image: [1080, 1456], visible: [794, 1412], anchor: [541, 1425] },
  'props/A08-central-fountain.png': { image: [1295, 1214], visible: [904, 916], anchor: [647, 1049] },
  'props/A09-waystone.png': { image: [1049, 1499], visible: [698, 1414], anchor: [541, 1438] },
  'props/A10-route-board.png': { image: [1024, 1536], visible: [985, 1321], anchor: [518.5, 1449] },
  'props/A11-northeast-warp-gate.png': { image: [1312, 1199], visible: [1236, 1143], anchor: [656, 1166] },
  'props/A12-lantern-post.png': { image: [1024, 1536], visible: [445, 1450], anchor: [552.5, 1491] },
  'props/A13-bench.png': { image: [1659, 948], visible: [1131, 409], anchor: [830.5, 805] },
  'props/A14-tree-trunk.png': { image: [1024, 1536], visible: [987, 1448], anchor: [517.5, 1508] },
  'props/A15-tree-canopy-broad.png': { image: [1610, 977], visible: [1571, 941], anchor: [804.5, 957] },
  'props/A16-tree-trunk-slim.png': { image: [1024, 1536], visible: [460, 1480], anchor: [533, 1508] },
  'props/A17-tree-canopy-slim.png': { image: [1402, 1122], visible: [1326, 840], anchor: [707, 980] },
  'props/A18-shrub-clump.png': { image: [1536, 1024], visible: [1303, 727], anchor: [783.5, 876] },
  'props/A19-flower-cluster.png': { image: [1536, 1024], visible: [1475, 649], anchor: [771.5, 830] },
  'props/A20-river-stone-cluster.png': { image: [1477, 1065], visible: [1078, 532], anchor: [766, 931] },
  'props/A21-warp-shimmer.png': { image: [1024, 1536], visible: [706, 1425], anchor: [510, 1486] },
};

const ASSETS: PlacedAsset[] = [
  { file: 'structures/A01-community-hall.png', x: 24, y: 8, box: [4.6, 3.6] },
  { file: 'structures/A02-house-a.png', x: 14, y: 11, box: [3, 2.6] },
  { file: 'structures/A03-house-b.png', x: 34, y: 11, box: [3.3, 2.8] },
  { file: 'structures/A04-house-c.png', x: 13, y: 23, box: [3, 2.6] },
  { file: 'structures/A05-community-pavilion.png', x: 34, y: 22, box: [4, 3] },
  { file: 'structures/A06-workshop.png', x: 10, y: 18, box: [4, 3.2] },
  { file: 'structures/A07-watchpost.png', x: 39, y: 8, box: [2.8, 3.8] },
  { file: 'props/A21-warp-shimmer.png', x: 43, y: 5, box: [1.1, 1.9], layer: 'behind' },
  { file: 'props/A11-northeast-warp-gate.png', x: 43, y: 5, box: [2.8, 2.8] },
  { file: 'props/A10-route-board.png', x: 38, y: 7, box: [1, 1.5] },
  { file: 'props/A08-central-fountain.png', x: 24, y: 16, box: [1.6, 1.6] },
  { file: 'props/A09-waystone.png', x: 27, y: 18, box: [1.4, 2] },
  { file: 'props/A12-lantern-post.png', x: 18, y: 15, box: [0.5, 1.6] },
  { file: 'props/A12-lantern-post.png', x: 30, y: 15, box: [0.5, 1.6] },
  { file: 'props/A12-lantern-post.png', x: 24, y: 22, box: [0.5, 1.6] },
  { file: 'props/A13-bench.png', x: 21, y: 21, box: [1.4, 0.8] },
  { file: 'props/A13-bench.png', x: 27, y: 21, box: [1.4, 0.8] },
  { file: 'props/A14-tree-trunk.png', x: 4, y: 4, box: [1.2, 1.8] },
  { file: 'props/A15-tree-canopy-broad.png', x: 4, y: 3.05, box: [3.8, 2.3], layer: 'canopy' },
  { file: 'props/A14-tree-trunk.png', x: 8, y: 3, box: [1.2, 1.8] },
  { file: 'props/A15-tree-canopy-broad.png', x: 8, y: 2.05, box: [3.8, 2.3], layer: 'canopy' },
  { file: 'props/A14-tree-trunk.png', x: 17, y: 4, box: [1.2, 1.8] },
  { file: 'props/A15-tree-canopy-broad.png', x: 17, y: 3.05, box: [3.8, 2.3], layer: 'canopy' },
  { file: 'props/A14-tree-trunk.png', x: 44, y: 4, box: [1.2, 1.8] },
  { file: 'props/A15-tree-canopy-broad.png', x: 44, y: 3.05, box: [3.8, 2.3], layer: 'canopy' },
  { file: 'props/A14-tree-trunk.png', x: 5, y: 27, box: [1.2, 1.8] },
  { file: 'props/A15-tree-canopy-broad.png', x: 5, y: 26.05, box: [3.8, 2.3], layer: 'canopy' },
  { file: 'props/A14-tree-trunk.png', x: 17, y: 29, box: [1.2, 1.8] },
  { file: 'props/A15-tree-canopy-broad.png', x: 17, y: 28.05, box: [3.8, 2.3], layer: 'canopy' },
  { file: 'props/A14-tree-trunk.png', x: 34, y: 29, box: [1.2, 1.8] },
  { file: 'props/A15-tree-canopy-broad.png', x: 34, y: 28.05, box: [3.8, 2.3], layer: 'canopy' },
  { file: 'props/A14-tree-trunk.png', x: 45, y: 27, box: [1.2, 1.8] },
  { file: 'props/A15-tree-canopy-broad.png', x: 45, y: 26.05, box: [3.8, 2.3], layer: 'canopy' },
  { file: 'props/A16-tree-trunk-slim.png', x: 3, y: 13, box: [0.5, 1.7] },
  { file: 'props/A17-tree-canopy-slim.png', x: 3, y: 12.1, box: [2.5, 2], layer: 'canopy' },
  { file: 'props/A16-tree-trunk-slim.png', x: 45, y: 14, box: [0.5, 1.7] },
  { file: 'props/A17-tree-canopy-slim.png', x: 45, y: 13.1, box: [2.5, 2], layer: 'canopy' },
  { file: 'props/A18-shrub-clump.png', x: 10, y: 6, box: [1.2, 0.8] },
  { file: 'props/A18-shrub-clump.png', x: 38, y: 25, box: [1.2, 0.8] },
  { file: 'props/A19-flower-cluster.png', x: 18, y: 24, box: [1.2, 0.55] },
  { file: 'props/A19-flower-cluster.png', x: 31, y: 8, box: [1.2, 0.55] },
  { file: 'props/A20-river-stone-cluster.png', x: 2, y: 27, box: [0.9, 0.65] },
  { file: 'props/A20-river-stone-cluster.png', x: 7, y: 30, box: [0.9, 0.65] },
];

const ROAD_PATHS: Array<Array<[number, number]>> = [
  [[24, 9], [24, 11]],
  [[30.5, 11.5], [33, 13], [37, 13], [43, 5]],
  [[16.5, 20], [13, 19], [10, 18]],
  [[30, 19], [32, 21], [34, 22]],
];

const RIVER_TILES: Array<[number, number]> = [
  [0, 14], [0, 16], [0, 18], [0, 20], [0, 22], [2, 22], [2, 24], [4, 24],
  [4, 26], [6, 26], [6, 28], [8, 28], [8, 30], [10, 30],
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
  private readonly spriteSize = 110;
  private readonly spriteOriginX = 627 / 1254;
  private readonly spriteOriginY = 1180 / 1254;

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
    for (const [key, path] of Object.entries({
      'map-grass': 'textures/TX-GRASS-01.png',
      'map-road': 'textures/TX-ROAD-01.png',
      'map-plaza': 'textures/TX-PLAZA-01.png',
      'map-river': 'textures/TX-RIVER-01.png',
    })) this.load.image(key, `${MAP_ROOT}${path}`);
    for (const file of Object.keys(METRICS)) this.load.image(file, `${MAP_ROOT}${file}`);
    preloadTraveler(this);
    for (const texture of MONSTER_TEXTURES) this.load.image(texture.key, texture.url);
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.error(`Failed to load ${file.key}: ${file.src}`);
      reportLoadingError(`โหลดไฟล์ ${file.key} ไม่สำเร็จ`);
    });
  }

  create() {
    registerTravelerAnimations(this);
    this.registerItemIconFrames();
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
      riverTilesH: RIVER_TILES,
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
    this.add.tileSprite(0, 0, this.worldWidth, this.worldHeight, 'map-grass')
      .setOrigin(0).setTileScale(2 * this.unit / 1254).setDepth(0);
    for (const [x, y] of RIVER_TILES) {
      this.add.tileSprite(x * this.unit, y * this.unit, 2 * this.unit, 2 * this.unit, 'map-river')
        .setOrigin(0).setTileScale(2 * this.unit / 1254).setDepth(0.1);
    }
    const [plazaW, plazaH] = this.layout.plazaH.size;
    this.add.tileSprite(
      (this.layout.plazaH.center[0] - plazaW / 2) * this.unit,
      (this.layout.plazaH.center[1] - plazaH / 2) * this.unit,
      plazaW * this.unit, plazaH * this.unit, 'map-plaza',
    ).setOrigin(0).setTileScale(1.5 * this.unit / 1254).setDepth(0.2);
    const roadCenters: Array<[number, number]> = [];
    for (let row = 0; row < this.layout.heightH; row++) {
      for (let col = 0; col < this.layout.widthH; col++) {
        const x = col + 0.5, y = row + 0.5;
        if (this.isRoadCell(x, y)) roadCenters.push([col, row]);
      }
    }
    for (const [x, y] of roadCenters) {
      this.add.tileSprite(x * this.unit, y * this.unit, this.unit, this.unit, 'map-road')
        .setOrigin(0).setTileScale(this.unit / 1254).setDepth(0.3);
    }
  }

  private isRoadCell(x: number, y: number) {
    const ring = this.layout.roadRingH;
    const dx = x - ring.center[0], dy = y - ring.center[1];
    const outer = (dx / ring.outerRadii[0]) ** 2 + (dy / ring.outerRadii[1]) ** 2;
    const inner = (dx / ring.innerRadii[0]) ** 2 + (dy / ring.innerRadii[1]) ** 2;
    if (outer <= 1 && inner >= 1) return true;
    for (const path of ROAD_PATHS) {
      for (let i = 0; i < path.length - 1; i++) {
        if (this.distanceToSegment([x, y], path[i], path[i + 1]) <= 0.76) return true;
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
    sprite.setDepth(asset.layer === 'canopy' ? 100_000 + baseDepth : asset.layer === 'behind' ? baseDepth : baseDepth + 1);
    if (asset.file === 'props/A21-warp-shimmer.png') {
      sprite.setAlpha(0.72);
      this.tweens.add({
        targets: sprite,
        alpha: { from: 0.72, to: 1 },
        duration: 480,
        ease: 'Sine.easeInOut',
        yoyo: true,
        hold: 110,
        repeat: -1,
        repeatDelay: 90,
      });
    }
    if (this.blocksWalking(asset)) {
      const visibleWidth = metric.visible[0] * sprite.scaleX;
      const baseBandHeight = (asset.file.startsWith('structures/') ? 0.58 : 0.34) * this.unit;
      const colliderHeight = Math.min(metric.visible[1] * sprite.scaleY, baseBandHeight);
      const widthFactor = asset.file.startsWith('structures/') ? 0.82 : 0.76;
      const colliderWidth = visibleWidth * widthFactor;
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
    return ![
      'props/A11-northeast-warp-gate.png',
      'props/A12-lantern-post.png',
      'props/A19-flower-cluster.png',
    ].includes(asset.file);
  }

  private setupPlayerAndCamera() {
    const spawnX = this.layout.spawnH[0] * this.unit;
    const spawnY = this.layout.spawnH[1] * this.unit;
    this.player = this.add.sprite(spawnX, spawnY, TRAVELER_IDLE_KEY)
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
