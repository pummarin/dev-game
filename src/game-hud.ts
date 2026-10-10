import Phaser from 'phaser';
import { CharacterStatus, type AttributeKey, type CharacterStatusSnapshot } from './character-status';
import { getItemDefinition, getItemPrices, getItemStatBonuses, INVENTORY_SLOT_CAPACITY, ITEM_RARITY_COLORS, ITEM_RARITY_LABELS, type ItemRarity } from './items/item-registry';
import type { EquipmentStack } from './items/item-hub';
import type { EquipmentBonuses, EquipmentSlot } from './items/item-registry';

type HudMapOptions = {
  widthH: number;
  heightH: number;
  pixelsPerH: number;
  gateH: [number, number];
  roadRingH: { center: [number, number]; outerRadii: [number, number] };
  roadPathsH: Array<Array<[number, number]>>;
  riverTilesH: Array<[number, number]>;
};
type HudPage = 'status' | 'inventory' | 'map' | 'settings';
type InventoryCategory = 'all' | 'consumable' | 'equipment' | 'material';
type InventoryDisplayItem = { itemId: string; name: string; description: string; count: number; category: Exclude<InventoryCategory, 'all'>; rarity: ItemRarity };

const PANEL = 0x152019;
const TRIM = 0xc4a96a;
const TEXT = '#f2ead7';
const MUTED = '#bdb9a6';
const withinRect = (x: number, y: number, boxX: number, boxY: number, boxW: number, boxH: number) =>
  x >= boxX && x <= boxX + boxW && y >= boxY && y <= boxY + boxH;
const rarityTextColor = (rarity: ItemRarity) => `#${ITEM_RARITY_COLORS[rarity].toString(16).padStart(6, '0')}`;

/** Screen-space HUD; each group is kept in its own container for easier extension. */
export class FrontierTownHud {
  private readonly status: Phaser.GameObjects.Container;
  private readonly objective: Phaser.GameObjects.Container;
  private readonly minimap: Phaser.GameObjects.Container;
  private readonly chat: Phaser.GameObjects.Container;
  private readonly hotbar: Phaser.GameObjects.Container;
  private readonly actions: Phaser.GameObjects.Container;
  private readonly notices: Phaser.GameObjects.Container;
  private modal: Phaser.GameObjects.Container;
  private readonly windowContainers = new Map<HudPage, Phaser.GameObjects.Container>();
  private readonly openWindows = new Set<HudPage>();
  private readonly windowOffsets = new Map<HudPage, { x: number; y: number }>();
  private draggingWindow: HudPage | null = null;
  private dragStart: { pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null = null;
  private readonly inventoryContextMenu: Phaser.GameObjects.Container;
  private readonly levelUpNotice: Phaser.GameObjects.Container;
  private readonly levelUpTitle: Phaser.GameObjects.Text;
  private readonly levelUpSummary: Phaser.GameObjects.Text;
  private readonly levelUpReward: Phaser.GameObjects.Text;
  private levelUpHideEvent?: Phaser.Time.TimerEvent;
  private playerMarker!: Phaser.GameObjects.Arc;
  private readonly exitNotice: Phaser.GameObjects.Text;
  private gameMessage!: Phaser.GameObjects.Text;
  private inventoryContents: InventoryDisplayItem[] = [];
  private equipmentContents: EquipmentStack[] = [];
  private inventoryCategory: InventoryCategory = 'all';
  private selectedItemId: string | null = null;
  private selectedEquipmentSlot: EquipmentSlot | null = null;
  private lastEquipmentClick: { itemId: string; time: number } | null = null;
  private inventoryScrollRow = 0;
  private objectiveText!: Phaser.GameObjects.Text;
  private levelLabel!: Phaser.GameObjects.Text;
  private experienceLabel!: Phaser.GameObjects.Text;
  private currencyLabel!: Phaser.GameObjects.Text;
  private currencyAmount = 0;
  private hpFill!: Phaser.GameObjects.Rectangle;
  private mpFill!: Phaser.GameObjects.Rectangle;
  private hpValueLabel!: Phaser.GameObjects.Text;
  private mpValueLabel!: Phaser.GameObjects.Text;
  private hpPotionCountLabel!: Phaser.GameObjects.Text;
  private mpPotionCountLabel!: Phaser.GameObjects.Text;
  private hpPotionNameLabel!: Phaser.GameObjects.Text;
  private mpPotionNameLabel!: Phaser.GameObjects.Text;
  private hpPotionIconLabel!: Phaser.GameObjects.Image;
  private mpPotionIconLabel!: Phaser.GameObjects.Image;
  private experienceFill!: Phaser.GameObjects.Rectangle;
  private readonly unsubscribeStatus: () => void;
  private activePage: HudPage | null = null;
  private hoveredAttribute: AttributeKey | null = null;
  private uiScale = 1;
  private consumedWorldPointer = false;
  private contextMenuItemId: string | null = null;
  private quantityInputValue = '1';
  private contextDropMaximum = 1;
  private assignedHpPotionId: string | null = null;
  private assignedMpPotionId: string | null = null;
  private dropInventoryItem?: (itemId: string, amount: number) => boolean;
  private useInventoryItem?: (itemId: string) => boolean;
  private equipInventoryItem?: (itemId: string) => boolean;
  private unequipEquipmentSlot?: (slot: EquipmentSlot) => boolean;
  private readonly preventCanvasContextMenu = (event: MouseEvent) => event.preventDefault();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Phaser.GameObjects.Sprite,
    private readonly map: HudMapOptions,
    private readonly characterStatus: CharacterStatus,
  ) {
    this.status = scene.add.container(0, 0);
    this.objective = scene.add.container(0, 0);
    this.minimap = scene.add.container(0, 0);
    this.chat = scene.add.container(0, 0);
    this.hotbar = scene.add.container(0, 0);
    this.actions = scene.add.container(0, 0);
    this.notices = scene.add.container(0, 0);
    this.modal = scene.add.container(0, 0).setVisible(false);
    this.windowContainers.set('status', this.modal);
    for (const page of ['inventory', 'map', 'settings'] as const) {
      this.windowContainers.set(page, scene.add.container(0, 0).setVisible(false));
    }
    this.inventoryContextMenu = scene.add.container(0, 0).setVisible(false);
    this.levelUpNotice = scene.add.container(0, 0).setVisible(false);
    this.levelUpNotice.add(scene.add.rectangle(0, 5, 446, 124, 0x080d09, 0.6));
    this.levelUpNotice.add(scene.add.rectangle(0, 0, 440, 118, 0x0d1711, 0.98)
      .setStrokeStyle(2, 0xd5b76c, 1));
    this.levelUpNotice.add(scene.add.rectangle(0, 0, 430, 108, PANEL, 0.98)
      .setStrokeStyle(1, 0x806d43, 0.9));
    const ornament = scene.add.graphics();
    ornament.lineStyle(1.5, 0xe4c879, 0.9);
    ornament.lineBetween(-207, -43, -196, -52);
    ornament.lineBetween(-207, 43, -196, 52);
    ornament.lineBetween(207, -43, 196, -52);
    ornament.lineBetween(207, 43, 196, 52);
    ornament.lineBetween(-158, 27, 158, 27);
    ornament.lineBetween(-184, -29, -178, -29);
    ornament.lineBetween(178, -29, 184, -29);
    ornament.fillStyle(0xe4c879, 0.95);
    ornament.fillTriangle(-164, 27, -158, 23, -152, 27);
    ornament.fillTriangle(-164, 27, -158, 31, -152, 27);
    ornament.fillTriangle(152, 27, 158, 23, 164, 27);
    ornament.fillTriangle(152, 27, 158, 31, 164, 27);
    this.levelUpNotice.add(ornament);
    const crest = scene.add.graphics().lineStyle(2, 0xf0d17a, 1);
    crest.fillStyle(0x263221, 1).fillCircle(0, -54, 12).strokeCircle(0, -54, 12);
    crest.lineBetween(-20, -54, -12, -54);
    crest.lineBetween(12, -54, 20, -54);
    crest.lineBetween(0, -75, 0, -66);
    crest.lineBetween(-8, -62, -5, -59);
    crest.lineBetween(8, -62, 5, -59);
    this.levelUpNotice.add(crest);
    this.levelUpTitle = this.text(this.levelUpNotice, 0, -25, 'LEVEL UP!', 30, '#f5d77d')
      .setOrigin(0.5, 0.5).setFontStyle('bold').setShadow(0, 1, '#8c682a', 5, true, true);
    this.levelUpSummary = this.text(this.levelUpNotice, 0, 2, 'LEVEL 1  →  LEVEL 2', 17, TEXT)
      .setOrigin(0.5, 0.5).setFontStyle('bold');
    this.levelUpReward = this.text(this.levelUpNotice, 0, 43, '+5 STATUS POINTS', 13, '#f2d27a')
      .setOrigin(0.5, 0.5).setFontStyle('bold');
    this.buildStatus();
    this.buildObjective();
    this.buildMinimap();
    this.buildChat();
    this.buildHotbar();
    this.buildActions();
    this.unsubscribeStatus = this.characterStatus.subscribe((snapshot) => this.updateStatusView(snapshot));
    this.exitNotice = this.text(this.notices, 0, 0, 'ปลายทางยังไม่มีฉากในโปรเจกต์', 13, '#fff0c2');
    this.panel(this.notices, 0, 0, 254, 36, 0x332719, 0xb98f55);
    this.notices.bringToTop(this.exitNotice);
    this.notices.setVisible(false);
    for (const container of [this.status, this.objective, this.minimap, this.chat, this.hotbar, this.actions, this.notices]) {
      container.setScrollFactor(0).setDepth(1_000_000);
    }
    this.windowContainers.forEach((container) => container.setScrollFactor(0).setDepth(1_000_010));
    this.inventoryContextMenu.setScrollFactor(0).setDepth(1_000_030);
    scene.game.canvas.addEventListener('contextmenu', this.preventCanvasContextMenu);
    this.levelUpNotice.setScrollFactor(0).setDepth(1_000_020);
    scene.input.keyboard?.on('keydown-ESC', this.closePage, this);
    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.input.on('pointerup', this.onPointerUp, this);
    scene.input.on('pointermove', this.onPointerMove, this);
    scene.input.keyboard?.on('keydown', this.onQuantityKeyDown, this);
    scene.input.on('wheel', this.onInventoryWheel, this);
    this.resize(scene.scale.width, scene.scale.height);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  update() {
    const x = Phaser.Math.Clamp(this.player.x / (this.map.widthH * this.map.pixelsPerH), 0, 1);
    const y = Phaser.Math.Clamp(this.player.y / (this.map.heightH * this.map.pixelsPerH), 0, 1);
    this.playerMarker.setPosition(10 + x * 146, 30 + y * 88);
  }

  setObjective(value: string) {
    this.objectiveText.setText(value);
  }

  setGameMessage(value: string) {
    this.gameMessage.setText(value);
  }

  showLevelUp(previousLevel: number, currentLevel: number, points: number) {
    this.levelUpTitle.setText('LEVEL UP!');
    this.levelUpSummary.setText(`LEVEL ${previousLevel}  →  LEVEL ${currentLevel}`);
    this.levelUpReward.setText(`+${points} STAT POINTS`);
    this.levelUpHideEvent?.remove(false);
    this.scene.tweens.killTweensOf(this.levelUpNotice);
    this.levelUpNotice.setAlpha(0).setScale(this.uiScale * 0.92).setVisible(true);
    this.scene.tweens.add({
      targets: this.levelUpNotice, alpha: 1, scaleX: this.uiScale, scaleY: this.uiScale,
      duration: 330, ease: 'Back.easeOut',
    });
    this.levelUpHideEvent = this.scene.time.delayedCall(2_600, () => {
      this.scene.tweens.add({
        targets: this.levelUpNotice, alpha: 0, duration: 450, ease: 'Quad.easeIn',
        onComplete: () => this.levelUpNotice.setVisible(false),
      });
    });
    for (let pulse = 0; pulse < 2; pulse++) {
      const halo = this.scene.add.ellipse(this.player.x, this.player.y - 54, 74, 100, 0xd6ad52, 0.12)
        .setStrokeStyle(3, 0xf4d67a, 0.88).setScale(0.72).setDepth(this.player.depth - 1);
      this.scene.tweens.add({
        targets: halo, scale: { from: 0.72, to: 1.45 }, alpha: { from: 0.9, to: 0 },
        duration: 850, delay: pulse * 180, ease: 'Cubic.easeOut', onComplete: () => halo.destroy(),
      });
    }
  }

  setInventoryContents(items: InventoryDisplayItem[]) {
    this.inventoryContents = items;
    this.updatePotionHotbarCounts();
    if (!items.some((item) => item.itemId === this.selectedItemId)) this.selectedItemId = items[0]?.itemId ?? null;
    if (this.openWindows.has('inventory')) this.renderPage(this.scene.scale.width, this.scene.scale.height, 'inventory');
  }

  setEquipmentContents(items: EquipmentStack[]) {
    this.equipmentContents = items;
    if (this.openWindows.has('inventory')) this.renderPage(this.scene.scale.width, this.scene.scale.height, 'inventory');
  }

  setCurrencyAmount(amount: number) {
    this.currencyAmount = amount;
    this.currencyLabel?.setText(`ทอง ${amount.toLocaleString()}`);
    if (this.openWindows.has('inventory')) this.renderPage(this.scene.scale.width, this.scene.scale.height, 'inventory');
  }

  setInventoryActions(
    drop: (itemId: string, amount: number) => boolean,
    use: (itemId: string) => boolean,
    equip: (itemId: string) => boolean,
    unequip: (slot: EquipmentSlot) => boolean,
  ) {
    this.dropInventoryItem = drop;
    this.useInventoryItem = use;
    this.equipInventoryItem = equip;
    this.unequipEquipmentSlot = unequip;
  }

  blocksWorldPointer(x: number, y: number) {
    const consumedByHud = this.consumedWorldPointer;
    this.consumedWorldPointer = false;
    if (consumedByHud || this.openWindows.size > 0) return true;
    return this.isHudPointer(x, y);
  }

  private isHudPointer(x: number, y: number) {
    const s = this.uiScale;
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const regions = [
      { x: 16, y: 16, w: 296, h: 132 },
      { x: 16, y: 16 + 148 * s, w: 296 * s, h: 62 * s },
      { x: width - 194 * s - 16, y: 16, w: 178 * s, h: 132 * s },
      { x: 16, y: height - 116 * s - 16, w: 280 * s, h: 100 * s },
      { x: this.hotbar.x, y: this.hotbar.y, w: 592 * s, h: 62 * s },
      { x: this.actions.x, y: this.actions.y, w: 232 * s, h: 62 * s },
    ];
    return regions.some((region) => withinRect(x, y, region.x, region.y, region.w, region.h));
  }

  showMissingDestination(show: boolean) {
    this.notices.setVisible(show);
  }

  resize(width: number, height: number) {
    this.uiScale = Math.min(1, Math.max(0.4, Math.min(width / 1160, height / 720)));
    const s = this.uiScale;
    this.status.setPosition(16, 16).setScale(s);
    this.objective.setPosition(16, 148 * s + 16).setScale(s);
    this.minimap.setPosition(width - 194 * s - 16, 16).setScale(s);
    this.chat.setPosition(16, height - 116 * s - 16).setScale(s);
    const barWidth = 592 * s;
    const actionsWidth = 232 * s;
    const leftClearance = 16 + (280 + 12) * s;
    const actionsX = width - actionsWidth - 16;
    const hotbarX = Math.max(leftClearance, (leftClearance + actionsX - 12 * s - barWidth) / 2);
    this.hotbar.setPosition(hotbarX, height - 78 * s - 16).setScale(s);
    this.actions.setPosition(actionsX, height - 78 * s - 16).setScale(s);
    this.notices.setPosition((width - 254 * s) / 2, height - 128 * s).setScale(s);
    this.levelUpNotice.setPosition(width / 2, 76 * s).setScale(s);
    this.clampWindowOffsets(width, height);
    this.renderOpenWindows(width, height);
  }

  destroy() {
    this.unsubscribeStatus();
    this.scene.input.keyboard?.off('keydown-ESC', this.closePage, this);
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointerup', this.onPointerUp, this);
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.scene.input.keyboard?.off('keydown', this.onQuantityKeyDown, this);
    this.scene.input.off('wheel', this.onInventoryWheel, this);
    this.scene.game.canvas.removeEventListener('contextmenu', this.preventCanvasContextMenu);
    this.levelUpHideEvent?.remove(false);
    for (const container of [this.status, this.objective, this.minimap, this.chat, this.hotbar, this.actions, this.notices,
      ...this.windowContainers.values(), this.levelUpNotice, this.inventoryContextMenu]) {
      container.destroy(true);
    }
  }

  private buildStatus() {
    this.panel(this.status, 0, 0, 296, 132);
    const portrait = this.scene.add.image(45, 48, 'idle-sheet', 0).setDisplaySize(54, 54);
    this.status.add(portrait);
    this.text(this.status, 82, 12, 'นักเดินทาง', 13, TEXT);
    this.levelLabel = this.text(this.status, 250, 10, 'Lv. 1', 13, '#e4c879').setOrigin(1, 0);
    this.hpFill = this.bar(this.status, 82, 35, 194, 15, 0xb94f48, 'HP');
    this.hpValueLabel = this.text(this.status, 275, 36, '', 8, '#fff5df').setOrigin(1, 0);
    this.mpFill = this.bar(this.status, 82, 58, 194, 15, 0x4089a0, 'MP');
    this.mpValueLabel = this.text(this.status, 275, 59, '', 8, '#fff5df').setOrigin(1, 0);
    this.experienceLabel = this.text(this.status, 82, 78, 'EXP 0 / 100', 8, MUTED);
    this.status.add(this.scene.add.rectangle(179, 95, 194, 6, 0x101713, 1).setStrokeStyle(1, 0x9d895a, 0.65));
    this.experienceFill = this.scene.add.rectangle(83, 92, 190, 4, 0xd7b55f, 0.95).setOrigin(0, 0);
    this.status.add(this.experienceFill);
    this.text(this.status, 10, 107, 'บัฟ', 10, MUTED);
    for (let index = 0; index < 6; index++) {
      const slot = this.scene.add.rectangle(44 + index * 27, 119, 22, 20, 0x202d25, 0.88)
        .setStrokeStyle(1, 0x9d895a, 0.7);
      this.status.add(slot);
    }
    this.currencyLabel = this.text(this.status, 286, 107, 'ทอง 0', 10, '#e4c879').setOrigin(1, 0);
  }

  private buildObjective() {
    this.panel(this.objective, 0, 0, 296, 62);
    this.text(this.objective, 12, 9, 'เป้าหมายภารกิจ', 12, '#e4c879');
    this.objectiveText = this.text(this.objective, 12, 32, 'ยังไม่มีเป้าหมายภารกิจ', 13, TEXT);
  }

  private buildMinimap() {
    this.panel(this.minimap, 0, 0, 178, 132);
    this.text(this.minimap, 10, 7, 'แผนที่ย่อ', 12, '#e4c879');
    const map = this.scene.add.graphics();
    const mapPoint = ([x, y]: [number, number]): [number, number] => [
      10 + (x / this.map.widthH) * 146,
      30 + (y / this.map.heightH) * 88,
    ];
    const [ringX, ringY] = mapPoint(this.map.roadRingH.center);
    const ringWidth = (this.map.roadRingH.outerRadii[0] / this.map.widthH) * 146 * 2;
    const ringHeight = (this.map.roadRingH.outerRadii[1] / this.map.heightH) * 88 * 2;
    map.lineStyle(5, 0x927f5d, 0.8);
    map.strokeEllipse(ringX, ringY, ringWidth, ringHeight);
    map.lineStyle(2.5, 0x927f5d, 0.85);
    for (const path of this.map.roadPathsH) {
      for (let index = 0; index < path.length - 1; index++) {
        const a = mapPoint(path[index]);
        const b = mapPoint(path[index + 1]);
        map.lineBetween(a[0], a[1], b[0], b[1]);
      }
    }
    map.lineStyle(2, 0x3b9dad, 0.9);
    const riverCenters = this.map.riverTilesH.map(([x, y]) => mapPoint([x + 1, y + 1]));
    for (let index = 0; index < riverCenters.length - 1; index++) {
      map.lineBetween(riverCenters[index][0], riverCenters[index][1], riverCenters[index + 1][0], riverCenters[index + 1][1]);
    }
    map.fillStyle(0x64c7d5, 0.9);
    map.fillCircle(ringX, ringY, 3);
    map.fillStyle(0xae82da, 0.95);
    const gate = mapPoint(this.map.gateH);
    map.fillCircle(gate[0], gate[1], 3.5);
    this.minimap.add(map);
    this.playerMarker = this.scene.add.circle(0, 0, 4, 0xffe18a).setStrokeStyle(1.5, 0x172019);
    this.minimap.add(this.playerMarker);
    this.minimap.bringToTop(this.playerMarker);
  }

  private buildChat() {
    this.panel(this.chat, 0, 0, 280, 100);
    this.text(this.chat, 10, 8, 'แชต', 12, '#e4c879');
    this.gameMessage = this.text(this.chat, 10, 34, 'ยังไม่มีข้อความ', 11, MUTED);
    this.text(this.chat, 10, 61, 'คลิกพื้นเดิน · คลิกมอนล็อก/ตีอัตโนมัติ', 9, '#d4d1c4');
    this.text(this.chat, 10, 79, 'WASD เดิน · Space โจมตี · E เก็บ', 9, '#d4d1c4');
  }

  private buildHotbar() {
    this.panel(this.hotbar, 0, 0, 592, 62);
    for (let index = 0; index < 9; index++) {
      this.hotbarSlot(index * 52 + 8, String(index + 1), '', MUTED);
    }
    this.hotbarSlot(476, '', '', '#ed7167');
    this.hotbarSlot(528, '', '', '#69c5e8');
    this.hpPotionCountLabel = this.text(this.hotbar, 510, 8, '', 9, '#ffe1a0').setOrigin(1, 0);
    this.mpPotionCountLabel = this.text(this.hotbar, 562, 8, '', 9, '#b9eaff').setOrigin(1, 0);
    this.hpPotionNameLabel = this.text(this.hotbar, 499, 40, '', 8, TEXT).setOrigin(0.5, 0);
    this.mpPotionNameLabel = this.text(this.hotbar, 551, 40, '', 8, TEXT).setOrigin(0.5, 0);
    this.hpPotionIconLabel = this.scene.add.image(499, 25, 'item-icons', 1).setDisplaySize(26, 26).setVisible(false);
    this.mpPotionIconLabel = this.scene.add.image(551, 25, 'item-icons', 1).setDisplaySize(26, 26).setVisible(false);
    this.hotbar.add([this.hpPotionIconLabel, this.mpPotionIconLabel]);
  }

  private buildActions() {
    this.panel(this.actions, 0, 0, 232, 62);
    const items: Array<{ page: HudPage; label: string; textureKey: string }> = [
      { page: 'status',    label: 'สถานะ',  textureKey: 'ui-icon-status'   },
      { page: 'inventory', label: 'กระเป๋า', textureKey: 'ui-icon-bag'      },
      { page: 'map',       label: 'แผนที่',  textureKey: 'ui-icon-map'      },
      { page: 'settings',  label: 'ตั้งค่า', textureKey: 'ui-icon-settings' },
    ];
    items.forEach((item, index) => {
      const x = 6 + index * 56;
      const button = this.scene.add.rectangle(x + 26, 30, 50, 52, 0x28342b, 0.98)
        .setStrokeStyle(1, TRIM, 0.82)
        .setInteractive({ useHandCursor: true });
      button.on('pointerover', () => button.setFillStyle(0x3a493b, 1));
      button.on('pointerout', () => button.setFillStyle(0x28342b, 0.98));
      this.actions.add(button);
      const icon = this.scene.add.image(x + 26, 20, item.textureKey).setDisplaySize(26, 26);
      this.actions.add(icon);
      this.text(this.actions, x + 26, 43, item.label, 8, TEXT).setOrigin(0.5, 0);
    });
  }

  /** Handle HUD clicks in screen coordinates so nested, scaled containers cannot swallow them. */
  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (this.inventoryContextMenu.visible) {
      this.consumedWorldPointer = true;
      this.handleInventoryContextMenuClick(pointer.x, pointer.y);
      return;
    }
    const page = this.windowAt(pointer.x, pointer.y);
    if (page) {
      this.focusWindow(page);
      this.consumedWorldPointer = true;
      const width = this.scene.scale.width;
      const height = this.scene.scale.height;
      const offset = this.windowOffsets.get(page) ?? { x: 0, y: 0 };
      const localX = pointer.x - offset.x;
      const localY = pointer.y - offset.y;
      const { cardWidth, cardHeight } = this.cardSize(page, width, height);
      const centerX = width / 2;
      const centerY = height / 2;
      const cardLeft = centerX - cardWidth / 2;
      const cardTop = centerY - cardHeight / 2;
      const closeIcon = withinRect(localX, localY, cardLeft + cardWidth - 39, cardTop + 12, 30, 30);
      if (closeIcon) {
        this.closeWindow(page);
        return;
      }
      if (pointer.button === 0 && withinRect(localX, localY, cardLeft, cardTop, cardWidth, 48)) {
        this.draggingWindow = page;
        this.dragStart = {
          pointerX: pointer.x, pointerY: pointer.y, offsetX: offset.x, offsetY: offset.y,
        };
        return;
      }
      if (page === 'inventory' && pointer.button === 2) {
        pointer.event?.preventDefault();
        const item = this.inventoryItemAt(localX, localY, width, cardWidth, cardTop);
        if (item) {
          this.selectedItemId = item.itemId;
          this.selectedEquipmentSlot = null;
          this.renderPage(width, height, page);
          this.openInventoryContextMenu(item, pointer.x, pointer.y);
        } else {
          const equipmentSlot = this.equipmentSlotAt(localX, localY, width, cardWidth, cardTop);
          if (equipmentSlot && this.equipmentContents.some((equipment) => equipment.slot === equipmentSlot)) {
            this.unequipEquipmentSlot?.(equipmentSlot);
            return;
          }
          this.inventoryContextMenu.setVisible(false);
          this.contextMenuItemId = null;
        }
        return;
      }
      if (!withinRect(localX, localY, cardLeft, cardTop, cardWidth, cardHeight)) return;
      const status = this.characterStatus.snapshot();
      const footerY = cardTop + cardHeight - 53;
      if (page === 'inventory') {
        const item = pointer.button === 0
          ? this.inventoryItemAt(localX, localY, width, cardWidth, cardTop)
          : undefined;
        if (item?.category === 'equipment') {
          const now = this.scene.time.now;
          if (this.lastEquipmentClick?.itemId === item.itemId && now - this.lastEquipmentClick.time <= 450) {
            this.lastEquipmentClick = null;
            this.equipInventoryItem?.(item.itemId);
            return;
          }
          this.lastEquipmentClick = { itemId: item.itemId, time: now };
        } else {
          this.lastEquipmentClick = null;
        }
        this.handleInventoryClick(localX, localY, width, cardWidth, cardTop);
        return;
      }
      if (page === 'status' && status.hasPending) {
        if (withinRect(localX, localY, centerX - 98, footerY, 88, 34)) {
          this.characterStatus.discardAllocation();
          return;
        }
        if (withinRect(localX, localY, centerX + 10, footerY, 88, 34)) {
          this.characterStatus.confirmAllocation();
          return;
        }
      }
      if (page === 'status') {
        const attributes: AttributeKey[] = ['STR', 'DEX', 'VIT', 'INT'];
        attributes.forEach((attribute, index) => {
          const rowTop = cardTop + 126 + index * 32;
          if (withinRect(localX, localY, centerX + cardWidth / 2 - 49, rowTop, 25, 26)) {
            this.characterStatus.stageAllocate(attribute);
          } else if (withinRect(localX, localY, centerX + cardWidth / 2 - 78, rowTop, 25, 26)) {
            this.characterStatus.stageDeallocate(attribute);
          }
        });
      }
      return;
    }

    if (this.isHudPointer(pointer.x, pointer.y)) this.consumedWorldPointer = true;

    const s = this.uiScale;
    const buttonY = this.actions.y + 4 * s;
    const buttonHeight = 52 * s;
    const pages: HudPage[] = ['status', 'inventory', 'map', 'settings'];
    for (let index = 0; index < pages.length; index++) {
      const buttonX = this.actions.x + (6 + index * 56) * s;
      if (withinRect(pointer.x, pointer.y, buttonX, buttonY, 50 * s, buttonHeight)) {
        this.openPage(pages[index]);
        return;
      }
    }

    // Potion hotbar slots — HP at local x=476, MP at local x=528 (slot width 46, height 54, y offset 4)
    if (pointer.button === 0 && !this.activePage) {
      const slotW = 46 * s;
      const slotH = 54 * s;
      const slotY = this.hotbar.y + 4 * s;
      const hpSlotX = this.hotbar.x + 476 * s;
      const mpSlotX = this.hotbar.x + 528 * s;
      if (withinRect(pointer.x, pointer.y, hpSlotX, slotY, slotW, slotH)) {
        this.usePotionFromHotbar('restoreHp');
        return;
      }
      if (withinRect(pointer.x, pointer.y, mpSlotX, slotY, slotW, slotH)) {
        this.usePotionFromHotbar('restoreMp');
        return;
      }
    }

    if (this.openWindows.size > 0) {
      this.consumedWorldPointer = true;
      return;
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    if (this.draggingWindow && this.dragStart) {
      const offset = {
        x: this.dragStart.offsetX + pointer.x - this.dragStart.pointerX,
        y: this.dragStart.offsetY + pointer.y - this.dragStart.pointerY,
      };
      const page = this.draggingWindow;
      const { cardWidth, cardHeight } = this.cardSize(page, width, height);
      offset.x = Phaser.Math.Clamp(offset.x, 8 + cardWidth / 2 - width / 2, width / 2 - cardWidth / 2 - 8);
      offset.y = Phaser.Math.Clamp(offset.y, 8 + cardHeight / 2 - height / 2, height / 2 - cardHeight / 2 - 8);
      this.windowOffsets.set(page, offset);
      this.windowContainers.get(page)?.setPosition(offset.x, offset.y);
      return;
    }
    const page = this.windowAt(pointer.x, pointer.y);
    if (page !== 'status' && this.hoveredAttribute !== null) {
      this.hoveredAttribute = null;
      this.renderPage(width, height, 'status');
    }
    if (page !== 'status') return;
    const offset = this.windowOffsets.get(page) ?? { x: 0, y: 0 };
    const localX = pointer.x - offset.x;
    const localY = pointer.y - offset.y;
    const cardWidth = Math.min(440, width - 32);
    const cardTop = height / 2 - Math.min(450, height - 32) / 2;
    const attributes: AttributeKey[] = ['STR', 'DEX', 'VIT', 'INT'];
    const cardLeft = width / 2 - cardWidth / 2;
    const hovered = attributes.find((_, index) => withinRect(
      localX, localY, cardLeft + 6, cardTop + 126 + index * 32, cardWidth - 12, 29,
    )) ?? null;
    if (hovered !== this.hoveredAttribute) {
      this.hoveredAttribute = hovered;
      this.renderPage(width, height, 'status');
    }
  }

  private onPointerUp() {
    this.draggingWindow = null;
    this.dragStart = null;
  }


  private openPage(page: HudPage) {
    this.inventoryContextMenu.setVisible(false);
    this.contextMenuItemId = null;
    const isNewWindow = !this.openWindows.has(page);
    if (isNewWindow) {
      const initialOffset = this.openWindows.size === 0 ? { x: 0, y: 0 } : { x: 24 * this.openWindows.size, y: 20 * this.openWindows.size };
      this.windowOffsets.set(page, initialOffset);
      this.openWindows.add(page);
    }
    this.activePage = page;
    this.focusWindow(page);
    if (isNewWindow) this.layoutStatusInventoryWindows();
    this.renderOpenWindows(this.scene.scale.width, this.scene.scale.height);
  }

  private closePage() {
    if (this.activePage) this.closeWindow(this.activePage);
  }

  private closeWindow(page: HudPage) {
    this.inventoryContextMenu.setVisible(false);
    this.contextMenuItemId = null;
    if (page === 'status') {
      this.characterStatus.discardAllocation();
      this.hoveredAttribute = null;
    }
    this.openWindows.delete(page);
    this.windowContainers.get(page)?.setVisible(false);
    if (this.activePage === page) {
      this.activePage = [...this.openWindows].pop() ?? null;
      if (this.activePage) this.focusWindow(this.activePage);
    }
  }

  private renderOpenWindows(width: number, height: number) {
    for (const page of this.openWindows) this.renderPage(width, height, page);
  }

  private renderPage(width: number, height: number, page = this.activePage) {
    if (!page || !this.openWindows.has(page)) return;
    const previousModal = this.modal;
    const previousPage = this.activePage;
    const container = this.windowContainers.get(page);
    if (!container) return;
    this.modal = container;
    this.activePage = page;
    const offset = this.windowOffsets.get(page) ?? { x: 0, y: 0 };
    container.setPosition(offset.x, offset.y).setVisible(true);
    this.modal.removeAll(true);
    const { cardWidth, cardHeight } = this.cardSize(page, width, height);
    const cardTop = height / 2 - cardHeight / 2;
    this.modal.add(this.scene.add.rectangle(width / 2, height / 2, cardWidth, cardHeight, PANEL, 0.98)
      .setStrokeStyle(2, TRIM, 0.95));

    const titles: Record<HudPage, string> = {
      status: 'สถานะตัวละคร', inventory: 'กระเป๋า', map: 'แผนที่', settings: 'ตั้งค่า',
    };
    this.text(this.modal, width / 2 - cardWidth / 2 + 24, cardTop + 22,
      titles[page], 22, '#e4c879');
    const close = this.scene.add.rectangle(width / 2 + cardWidth / 2 - 24, cardTop + 27,
      30, 30, 0x28342b, 1).setStrokeStyle(1, TRIM, 0.85);
    this.modal.add(close);
    this.text(this.modal, close.x, close.y - 10, '×', 22, TEXT).setOrigin(0.5, 0);

    if (page === 'status') this.renderStatusPage(width, cardWidth, cardTop);
    else if (page === 'inventory') this.renderInventoryPage(width, cardWidth, cardHeight, cardTop);
    else {
      const content: Record<'map' | 'settings', string[]> = {
        map: ['แผนที่ย่อแสดงตำแหน่งในเมืองปัจจุบัน', 'หน้าแผนที่เต็มยังไม่พร้อมใช้งาน'],
        settings: ['ตัวเลือกการตั้งค่ายังไม่เชื่อมต่อ'],
      };
      content[page].forEach((line, index) => {
        this.text(this.modal, width / 2 - cardWidth / 2 + 26, cardTop + 82 + index * 36, line, 14, index === 0 ? TEXT : MUTED);
      });
    }
    const hasPending = page === 'status' && this.characterStatus.snapshot().hasPending;
    const footerY = cardTop + cardHeight - 36;
    if (hasPending) {
      this.footerButton(width / 2 - 54, footerY, 88, 'ยกเลิก', false);
      this.footerButton(width / 2 + 54, footerY, 88, 'ยืนยัน', true);
    }
    this.modal = previousModal;
    this.activePage = previousPage;
  }

  private focusWindow(page: HudPage) {
    if (!this.openWindows.has(page)) return;
    this.openWindows.delete(page);
    this.openWindows.add(page);
    this.activePage = page;
    const ordered = [...this.openWindows].filter((candidate) => candidate !== page).concat(page);
    ordered.forEach((candidate, index) => this.windowContainers.get(candidate)?.setDepth(1_000_010 + index));
    const container = this.windowContainers.get(page);
    if (container) this.modal = container;
  }

  private windowAt(x: number, y: number): HudPage | null {
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const pages = [...this.openWindows].reverse();
    for (const page of pages) {
      const { cardWidth, cardHeight } = this.cardSize(page, width, height);
      const offset = this.windowOffsets.get(page) ?? { x: 0, y: 0 };
      const localX = x - offset.x;
      const localY = y - offset.y;
      if (withinRect(localX, localY, width / 2 - cardWidth / 2, height / 2 - cardHeight / 2, cardWidth, cardHeight)) return page;
    }
    return null;
  }

  private layoutStatusInventoryWindows() {
    if (!this.openWindows.has('status') || !this.openWindows.has('inventory')) return;
    const width = this.scene.scale.width;
    const statusWidth = this.cardSize('status', width, this.scene.scale.height).cardWidth;
    const inventoryWidth = this.cardSize('inventory', width, this.scene.scale.height).cardWidth;
    const gap = 20;
    const totalWidth = statusWidth + gap + inventoryWidth;
    let statusLeft = Math.max(8, (width - totalWidth) / 2);
    let inventoryLeft = statusLeft + statusWidth + gap;
    if (inventoryLeft + inventoryWidth > width - 8) {
      const overflow = inventoryLeft + inventoryWidth - (width - 8);
      statusLeft = Math.max(8, statusLeft - overflow);
      inventoryLeft = statusLeft + statusWidth + gap;
    }
    this.windowOffsets.set('status', { x: statusLeft + statusWidth / 2 - width / 2, y: 0 });
    this.windowOffsets.set('inventory', { x: inventoryLeft + inventoryWidth / 2 - width / 2, y: 0 });
  }

  private clampWindowOffsets(width: number, height: number) {
    for (const page of this.openWindows) {
      const { cardWidth, cardHeight } = this.cardSize(page, width, height);
      const offset = this.windowOffsets.get(page) ?? { x: 0, y: 0 };
      offset.x = Phaser.Math.Clamp(offset.x, 8 + cardWidth / 2 - width / 2, width / 2 - cardWidth / 2 - 8);
      offset.y = Phaser.Math.Clamp(offset.y, 8 + cardHeight / 2 - height / 2, height / 2 - cardHeight / 2 - 8);
      this.windowOffsets.set(page, offset);
    }
  }

  private renderStatusPage(width: number, cardWidth: number, cardTop: number) {
    const snapshot = this.characterStatus.snapshot();
    const left = width / 2 - cardWidth / 2 + 24;
    this.text(this.modal, left, cardTop + 61,
      `เลเวล ${snapshot.level}     EXP ${snapshot.experience} / ${snapshot.experienceToNext}`, 14, TEXT);
    const pendingNote = snapshot.hasPending ? '  ·  ยังไม่ยืนยัน' : '';
    this.text(this.modal, left, cardTop + 83, `แต้มสถานะที่เหลือ: ${snapshot.availablePoints}${pendingNote}`, 13, '#e4c879');
    this.text(this.modal, left, cardTop + 105, 'ค่าสถานะหลัก  ·  กด + เพื่อใช้แต้ม', 12, MUTED);

    const rows: AttributeKey[] = ['STR', 'DEX', 'VIT', 'INT'];
    rows.forEach((row, index) => {
      const y = cardTop + 126 + index * 32;
      this.modal.add(this.scene.add.rectangle(width / 2, y + 13, cardWidth - 36, 29, 0x202b23, 0.8)
        .setStrokeStyle(1, 0x665a3e, 0.55));
      this.text(this.modal, left + 8, y + 2, row, 12, TEXT);
      const right = width / 2 + cardWidth / 2;
      this.text(this.modal, right - 117, y + 3, String(snapshot.draftAttributes[row]), 13, '#e4c879');
      const minusX = right - 66;
      const canDecrease = snapshot.draftAttributes[row] > snapshot.attributes[row];
      this.modal.add(this.scene.add.rectangle(minusX, y + 13, 25, 25,
        canDecrease ? 0x405442 : 0x303830, 1).setStrokeStyle(1, TRIM, 0.8));
      this.text(this.modal, minusX, y + 1, '−', 16, canDecrease ? TEXT : MUTED).setOrigin(0.5, 0);
      const buttonX = right - 36;
      const plus = this.scene.add.rectangle(buttonX, y + 13, 25, 25,
        snapshot.availablePoints > 0 ? 0x405442 : 0x303830, 1).setStrokeStyle(1, TRIM, 0.8);
      this.modal.add(plus);
      this.text(this.modal, buttonX, y + 1, '+', 18, snapshot.availablePoints > 0 ? TEXT : MUTED).setOrigin(0.5, 0);
    });

    this.text(this.modal, left, cardTop + 263, 'Details', 12, '#e4c879');
    const derived = snapshot.previewDerived;
    const detailPanel = this.scene.add.rectangle(width / 2, cardTop + 328, cardWidth - 48, 102, 0x101913, 0.98)
      .setStrokeStyle(1, 0x665a3e, 0.85);
    this.modal.add(detailPanel);
    const derivedRows = [
      [`HP  ${snapshot.currentHp} / ${derived.maxHp}`, `MP  ${snapshot.currentMp} / ${derived.maxMp}`],
      [`โจมตีกายภาพ  ${derived.physicalAttack}`, `โจมตีเวท  ${derived.magicAttack}`],
      [`ป้องกัน  ${derived.physicalDefense}`, `คริติคอล  ${derived.criticalChance.toFixed(1)}%`],
      [`คริดาเมจ  ${derived.criticalDamage}%`, `ความเร็วโจมตี  ${derived.attackSpeed}%`],
      [`ความเร็วเดิน  ${derived.movementSpeed}`, ''],
    ];
    derivedRows.forEach(([first, second], index) => {
      const y = cardTop + 291 + index * 19;
      this.text(this.modal, left + 8, y, first, 10, TEXT);
      this.text(this.modal, width / 2 + 14, y, second, 10, TEXT);
    });
    if (this.hoveredAttribute) this.renderAttributeTooltip(width, cardWidth, cardTop, this.hoveredAttribute);
  }

  private cardSize(page: HudPage, width: number, height: number) {
    const desiredWidth = page === 'inventory' ? 850 : 440;
    const desiredHeight = page === 'inventory' ? 560 : page === 'status' ? 450 : 270;
    return { cardWidth: Math.min(desiredWidth, width - 32), cardHeight: Math.min(desiredHeight, height - 32) };
  }

  private renderInventoryPage(width: number, cardWidth: number, cardHeight: number, cardTop: number) {
    const cardLeft = width / 2 - cardWidth / 2;
    const walletWidth = 144;
    const walletX = cardLeft + cardWidth - walletWidth - 48;
    const walletY = cardTop + 27;
    this.modal.add(this.scene.add.rectangle(walletX + walletWidth / 2, walletY, walletWidth, 30,
      0x202b23, 0.96).setStrokeStyle(1, TRIM, 0.82));
    const coin = this.scene.add.graphics();
    coin.fillStyle(0x8b6427, 1).fillCircle(walletX + 17, walletY, 9);
    coin.lineStyle(1.5, 0xf0d27a, 1).strokeCircle(walletX + 17, walletY, 7);
    coin.lineBetween(walletX + 17, walletY - 4, walletX + 17, walletY + 4);
    coin.lineBetween(walletX + 14, walletY - 2, walletX + 20, walletY - 2);
    coin.lineBetween(walletX + 14, walletY + 2, walletX + 20, walletY + 2);
    this.modal.add(coin);
    this.text(this.modal, walletX + 32, walletY - 8, `ทอง ${this.currencyAmount.toLocaleString()}`, 11, '#e4c879');
    const paperX = cardLeft + 18;
    const paneY = cardTop + 62;
    const paperWidth = 260;
    const paneHeight = cardHeight - 110;
    const itemsX = cardLeft + 292;
    const itemsWidth = cardWidth - 310;
    const paper = this.scene.add.rectangle(paperX + paperWidth / 2, paneY + paneHeight / 2,
      paperWidth, paneHeight, 0x101913, 0.75).setStrokeStyle(1, 0x665a3e, 0.8);
    this.modal.add(paper);
    this.modal.add(this.scene.add.rectangle(itemsX + itemsWidth / 2, paneY + paneHeight / 2,
      itemsWidth, paneHeight, 0x101913, 0.75).setStrokeStyle(1, 0x665a3e, 0.8));

    const characterX = paperX + paperWidth / 2;
    const characterY = paneY + paneHeight / 2 + 5;
    this.modal.add(this.scene.add.ellipse(characterX, characterY + 42, 92, 24, 0x54452e, 0.45));
    this.modal.add(this.scene.add.image(characterX, characterY, 'idle-sheet', 0)
      .setDisplaySize(145, 145).setOrigin(0.5, 0.5));
    const equipment = [
      { id: 'head' as const, label: 'หัว', side: -1, row: 0 },
      { id: 'weapon' as const, label: 'อาวุธ', side: -1, row: 1 },
      { id: 'necklace' as const, label: 'สร้อย', side: -1, row: 3 },
      { id: 'ring1' as const, label: 'แหวน 1', side: -1, row: 4 },
      { id: 'armor' as const, label: 'เกราะ', side: 1, row: 0 },
      { id: 'offhand' as const, label: 'มือรอง', side: 1, row: 1 },
      { id: 'gloves' as const, label: 'ถุงมือ', side: 1, row: 2 },
      { id: 'boots' as const, label: 'รองเท้า', side: 1, row: 3 },
      { id: 'ring2' as const, label: 'แหวน 2', side: 1, row: 4 },
    ];
    equipment.forEach((slot) => {
      const x = characterX + slot.side * 91;
      const y = paneY + 56 + slot.row * 69;
      const item = this.equipmentContents.find((equipped) => equipped.slot === slot.id);
      this.modal.add(this.scene.add.rectangle(x, y, 48, 43, 0x202b23, 0.95)
        .setStrokeStyle(1, item ? ITEM_RARITY_COLORS[item.rarity] : TRIM, item ? 1 : 0.75));
      if (item) {
        const definition = getItemDefinition(item.itemId);
        if (definition) this.modal.add(this.scene.add.image(x, y - 4, 'item-icons', definition.iconFrame).setDisplaySize(28, 28));
      }
      this.text(this.modal, x, y + 23, slot.label, 9, MUTED).setOrigin(0.5, 0);
    });
    this.text(this.modal, characterX, paneY + paneHeight - 24, 'อุปกรณ์สวมใส่', 10, '#e4c879').setOrigin(0.5, 0);

    const categories: Array<{ id: InventoryCategory; label: string }> = [
      { id: 'all', label: 'All' }, { id: 'consumable', label: 'Consumable' },
      { id: 'equipment', label: 'Equipment' }, { id: 'material', label: 'Material' },
    ];
    const tabX = itemsX + 10;
    const tabY = paneY + 10;
    const tabWidth = (itemsWidth - 20) / categories.length;
    categories.forEach((category, index) => {
      const x = tabX + index * tabWidth;
      const selected = this.inventoryCategory === category.id;
      this.modal.add(this.scene.add.rectangle(x + tabWidth / 2, tabY + 15, tabWidth - 3, 30,
        selected ? 0x405442 : 0x202b23, 1).setStrokeStyle(1, selected ? TRIM : 0x665a3e, 0.8));
      this.text(this.modal, x + tabWidth / 2, tabY + 7, category.label,
        Math.min(11, tabWidth < 80 ? 8 : 11), selected ? '#f0d88d' : TEXT).setOrigin(0.5, 0);
    });
    this.text(this.modal, itemsX + itemsWidth - 10, paneY + 47,
      `${this.inventoryContents.length}/${INVENTORY_SLOT_CAPACITY} ช่อง`, 9, MUTED).setOrigin(1, 0);

    const filtered = this.inventoryContents.filter((item) =>
      this.inventoryCategory === 'all' || item.category === this.inventoryCategory);
    const { cell, gap, rows } = this.inventoryGridDimensions(itemsWidth, paneHeight);
    const gridX = itemsX + 16;
    const gridY = paneY + 62;
    const columns = 7;
    const maxRows = Math.ceil(INVENTORY_SLOT_CAPACITY / columns);
    const gridHeight = rows * cell + (rows - 1) * gap;
    const maxScrollRow = Math.max(0, maxRows - rows);
    this.inventoryScrollRow = Phaser.Math.Clamp(this.inventoryScrollRow, 0, maxScrollRow);
    for (let index = 0; index < columns * rows; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = gridX + column * (cell + gap);
      const y = gridY + row * (cell + gap);
      const slotIndex = (this.inventoryScrollRow + row) * columns + column;
      const item = slotIndex < INVENTORY_SLOT_CAPACITY ? filtered[slotIndex] : undefined;
      const selected = item?.itemId === this.selectedItemId;
      const rarityColor = item ? ITEM_RARITY_COLORS[item.rarity] : 0x665a3e;
      this.modal.add(this.scene.add.rectangle(x + cell / 2, y + cell / 2, cell, cell,
        selected ? 0x344437 : 0x18221b, 1).setStrokeStyle(1, selected ? TRIM : rarityColor, item ? 0.9 : 0.65));
      if (!item) continue;
      const definition = getItemDefinition(item.itemId);
      if (definition) this.modal.add(this.scene.add.image(x + cell / 2, y + cell * 0.39, 'item-icons', definition.iconFrame)
        .setDisplaySize(Math.min(48, cell * 0.78), Math.min(48, cell * 0.78)));
      const kindLabel = item.category === 'material' ? 'วัสดุ' : item.category === 'consumable' ? 'ใช้' : 'สวม';
      this.text(this.modal, x + cell / 2, y + cell * 0.64, kindLabel, 8, TEXT).setOrigin(0.5, 0);
      this.text(this.modal, x + cell - 5, y + cell - 15, `×${item.count}`, 9, '#e4c879').setOrigin(1, 0);
    }
    const trackX = gridX + columns * (cell + gap) - gap + 9;
    const thumbHeight = Math.max(24, gridHeight * rows / maxRows);
    const thumbTravel = gridHeight - thumbHeight;
    this.modal.add(this.scene.add.rectangle(trackX, gridY + gridHeight / 2, 3, gridHeight, 0x2b352d, 0.9));
    this.modal.add(this.scene.add.rectangle(trackX,
      gridY + thumbHeight / 2 + (maxScrollRow ? thumbTravel * this.inventoryScrollRow / maxScrollRow : 0),
      5, thumbHeight, TRIM, 0.9));

    const selectedItem = filtered.find((item) => item.itemId === this.selectedItemId);
    const selectedEquipment = this.equipmentContents.find((item) => item.slot === this.selectedEquipmentSlot);
    const detailY = paneY + paneHeight - 94;
    this.modal.add(this.scene.add.rectangle(itemsX + itemsWidth / 2, detailY + 34,
      itemsWidth - 20, 68, 0x202b23, 0.9).setStrokeStyle(1, 0x665a3e, 0.75));
    if (selectedItem) {
      this.text(this.modal, itemsX + 20, detailY + 8,
        `${selectedItem.name}  ×${selectedItem.count}  ·  ${ITEM_RARITY_LABELS[selectedItem.rarity]}`, 12, rarityTextColor(selectedItem.rarity));
      const definition = getItemDefinition(selectedItem.itemId);
      if (definition?.category === 'equipment') {
        this.text(this.modal, itemsX + 20, detailY + 33,
          this.equipmentBonusSummary(getItemStatBonuses(selectedItem.itemId)), 9, '#e4c879');
      }
      const prices = getItemPrices(selectedItem.itemId);
      if (prices) this.text(this.modal, itemsX + 20, detailY + 53,
        `ซื้อ ${prices.buyPrice}  ·  ขาย ${prices.sellPrice} ทอง`, 9, MUTED);
    } else if (selectedEquipment) {
      this.text(this.modal, itemsX + 20, detailY + 7,
        `${selectedEquipment.name}  ·  ${ITEM_RARITY_LABELS[selectedEquipment.rarity]}`, 12, rarityTextColor(selectedEquipment.rarity));
      this.text(this.modal, itemsX + 20, detailY + 39,
        this.equipmentBonusSummary(selectedEquipment.statBonuses), 9, '#e4c879');
      const prices = getItemPrices(selectedEquipment.itemId);
      if (prices) this.text(this.modal, itemsX + 20, detailY + 53,
        `ซื้อ ${prices.buyPrice}  ·  ขาย ${prices.sellPrice} ทอง`, 9, MUTED);
    } else {
      this.text(this.modal, itemsX + 20, detailY + 20, 'เลือกไอเทมเพื่อดูรายละเอียด', 11, MUTED);
    }
  }

  private handleInventoryClick(x: number, y: number, width: number, cardWidth: number, cardTop: number) {
    const equippedSlot = this.equipmentSlotAt(x, y, width, cardWidth, cardTop);
    if (equippedSlot) {
      const equipment = this.equipmentContents.find((item) => item.slot === equippedSlot);
      this.selectedEquipmentSlot = equipment ? equippedSlot : null;
      this.selectedItemId = null;
      this.renderPage(width, this.scene.scale.height);
      return;
    }
    const cardLeft = width / 2 - cardWidth / 2;
    const itemsX = cardLeft + 292;
    const itemsWidth = cardWidth - 310;
    const tabX = itemsX + 10;
    const tabY = cardTop + 72;
    const tabWidth = (itemsWidth - 20) / 4;
    const categoryIds: InventoryCategory[] = ['all', 'consumable', 'equipment', 'material'];
    if (withinRect(x, y, tabX, tabY, itemsWidth - 20, 30)) {
      const index = Math.floor((x - tabX) / tabWidth);
      if (categoryIds[index]) {
        this.inventoryCategory = categoryIds[index];
        this.inventoryScrollRow = 0;
        const first = this.inventoryContents.find((item) => this.inventoryCategory === 'all' || item.category === this.inventoryCategory);
        this.selectedItemId = first?.itemId ?? null;
        this.renderPage(width, this.scene.scale.height);
      }
      return;
    }
    const item = this.inventoryItemAt(x, y, width, cardWidth, cardTop);
    if (item) {
      this.selectedItemId = item.itemId;
      this.selectedEquipmentSlot = null;
      this.renderPage(width, this.scene.scale.height);
    }
  }

  private equipmentBonusSummary(bonuses?: EquipmentBonuses) {
    if (!bonuses) return '—';
    const labels: Partial<Record<keyof EquipmentBonuses, string>> = {
      maxHp: 'HP สูงสุด', maxMp: 'MP สูงสุด', physicalAttack: 'โจมตีกายภาพ', magicAttack: 'โจมตีเวท',
      physicalDefense: 'ป้องกัน', criticalChance: 'คริติคอล', attackSpeed: 'ความเร็วโจมตี', movementSpeed: 'ความเร็วเดิน',
    };
    return Object.entries(bonuses)
      .filter(([, value]) => value !== undefined && value !== 0)
      .map(([key, value]) => {
      const suffix = key === 'criticalChance' || key === 'criticalDamage' || key === 'attackSpeed' ? '%' : '';
      return `${labels[key as keyof EquipmentBonuses] ?? key} +${value}${suffix}`;
    }).join(' · ') || '—';
  }

  private inventoryItemAt(x: number, y: number, width: number, cardWidth: number, cardTop: number) {
    const cardLeft = width / 2 - cardWidth / 2;
    const itemsX = cardLeft + 292;
    const itemsWidth = cardWidth - 310;
    const cardHeight = this.cardSize('inventory', width, this.scene.scale.height).cardHeight;
    const { cell, gap, rows } = this.inventoryGridDimensions(itemsWidth, cardHeight - 110);
    const gridX = itemsX + 16;
    const gridY = cardTop + 62 + 62;
    const column = Math.floor((x - gridX) / (cell + gap));
    const row = Math.floor((y - gridY) / (cell + gap));
    if (column < 0 || column >= 7 || row < 0 || row >= rows) return undefined;
    if ((x - gridX) % (cell + gap) > cell || (y - gridY) % (cell + gap) > cell) return undefined;
    const filtered = this.inventoryContents.filter((item) =>
      this.inventoryCategory === 'all' || item.category === this.inventoryCategory);
    const slotIndex = (this.inventoryScrollRow + row) * 7 + column;
    return slotIndex < INVENTORY_SLOT_CAPACITY ? filtered[slotIndex] : undefined;
  }

  private equipmentSlotAt(x: number, y: number, width: number, cardWidth: number, cardTop: number): EquipmentSlot | null {
    const cardLeft = width / 2 - cardWidth / 2;
    const characterX = cardLeft + 18 + 260 / 2;
    const paneY = cardTop + 62;
    const slots: Array<{ id: EquipmentSlot; side: number; row: number }> = [
      { id: 'head', side: -1, row: 0 }, { id: 'weapon', side: -1, row: 1 },
      { id: 'necklace', side: -1, row: 3 }, { id: 'ring1', side: -1, row: 4 },
      { id: 'armor', side: 1, row: 0 }, { id: 'offhand', side: 1, row: 1 },
      { id: 'gloves', side: 1, row: 2 }, { id: 'boots', side: 1, row: 3 }, { id: 'ring2', side: 1, row: 4 },
    ];
    return slots.find((slot) => {
      const slotX = characterX + slot.side * 91;
      const slotY = paneY + 56 + slot.row * 69;
      return withinRect(x, y, slotX - 24, slotY - 21.5, 48, 43);
    })?.id ?? null;
  }

  private openInventoryContextMenu(item: InventoryDisplayItem, pointerX: number, pointerY: number) {
    this.inventoryContextMenu.removeAll(true);
    this.contextMenuItemId = item.itemId;
    const effect = getItemDefinition(item.itemId)?.useEffect?.type;
    const definition = getItemDefinition(item.itemId);
    const options = [
      ...(item.category === 'consumable' ? [{ action: 'use', label: 'ใช้ไอเทม' }] : []),
      ...(definition?.category === 'equipment' ? [{ action: 'equip', label: 'สวมใส่' }] : []),
      ...(effect === 'restoreHp' ? [{ action: 'assignHp', label: 'ใส่ช่อง HP potion' }] : []),
      ...(effect === 'restoreMp' ? [{ action: 'assignMp', label: 'ใส่ช่อง MP potion' }] : []),
      { action: 'drop', label: 'ทิ้ง…' },
    ];
    const width = 142;
    const rowHeight = 34;
    const height = options.length * rowHeight + 8;
    const x = Phaser.Math.Clamp(pointerX, 8, this.scene.scale.width - width - 8);
    const y = Phaser.Math.Clamp(pointerY, 8, this.scene.scale.height - height - 8);
    this.inventoryContextMenu.add(this.scene.add.rectangle(x + width / 2, y + height / 2,
      width, height, 0x111a14, 0.99).setStrokeStyle(1, TRIM, 0.95));
    options.forEach((option, index) => {
      const rowY = y + 4 + index * rowHeight;
      this.inventoryContextMenu.add(this.scene.add.rectangle(x + width / 2, rowY + rowHeight / 2,
        width - 8, rowHeight - 2, 0x243128, 0.98));
      this.text(this.inventoryContextMenu, x + 14, rowY + 8, option.label, 12, TEXT);
      this.inventoryContextMenu.setData(`action-${index}`, option.action);
    });
    this.inventoryContextMenu.setData('menuBounds', { x, y, width, height, rowHeight, optionCount: options.length });
    this.inventoryContextMenu.setVisible(true);
  }

  private handleInventoryContextMenuClick(x: number, y: number) {
    const bounds = this.inventoryContextMenu.getData('menuBounds') as
      { x: number; y: number; width: number; height: number; rowHeight?: number; optionCount?: number; mode?: 'quantity' } | undefined;
    if (!bounds || !withinRect(x, y, bounds.x, bounds.y, bounds.width, bounds.height)) {
      this.inventoryContextMenu.setVisible(false);
      this.contextMenuItemId = null;
      return;
    }
    if (bounds.mode === 'quantity') {
      if (withinRect(x, y, bounds.x + 142, bounds.y + 94, 50, 24)) {
        const itemId = this.contextMenuItemId;
        const amount = Number.parseInt(this.quantityInputValue, 10);
        if (!Number.isInteger(amount) || amount < 1 || amount > this.contextDropMaximum) {
          this.setGameMessage(`กรอกจำนวน 1 ถึง ${this.contextDropMaximum}`);
          return;
        }
        this.inventoryContextMenu.setVisible(false);
        this.contextMenuItemId = null;
        if (itemId) this.dropInventoryItem?.(itemId, amount);
      } else if (withinRect(x, y, bounds.x + 88, bounds.y + 94, 54, 24)) {
        this.inventoryContextMenu.setVisible(false);
        this.contextMenuItemId = null;
      }
      return;
    }
    if (bounds.rowHeight === undefined || bounds.optionCount === undefined) return;
    const row = Math.floor((y - bounds.y - 4) / bounds.rowHeight);
    const action = row >= 0 && row < bounds.optionCount
      ? this.inventoryContextMenu.getData(`action-${row}`) as 'use' | 'equip' | 'drop' | 'assignHp' | 'assignMp'
      : undefined;
    const itemId = this.contextMenuItemId;
    this.inventoryContextMenu.setVisible(false);
    this.contextMenuItemId = null;
    if (!itemId || !action) return;
    if (action === 'use') this.useInventoryItem?.(itemId);
    else if (action === 'equip') this.equipInventoryItem?.(itemId);
    else if (action === 'assignHp' || action === 'assignMp') {
      const item = getItemDefinition(itemId);
      if (!item) return;
      if (action === 'assignHp' && item.useEffect?.type === 'restoreHp') this.assignedHpPotionId = itemId;
      else if (action === 'assignMp' && item.useEffect?.type === 'restoreMp') this.assignedMpPotionId = itemId;
      else return;
      this.updatePotionHotbarCounts();
      this.setGameMessage(`ใส่ ${item.name} ในช่อง ${action === 'assignHp' ? 'HP' : 'MP'} แล้ว`);
    }
    else if (action === 'drop') {
      const item = this.inventoryContents.find((entry) => entry.itemId === itemId);
      if (item) {
        this.quantityInputValue = '';
        this.openDropQuantityPicker(itemId, item.count);
      }
    }
  }

  private openDropQuantityPicker(itemId: string, maximum: number) {
    this.inventoryContextMenu.removeAll(true);
    this.contextMenuItemId = itemId;
    this.contextDropMaximum = Math.max(1, maximum);
    const currentAmount = Number.parseInt(this.quantityInputValue, 10);
    if (this.quantityInputValue && (!Number.isInteger(currentAmount) || currentAmount < 1 || currentAmount > this.contextDropMaximum)) {
      this.quantityInputValue = '';
    }
    const width = 204;
    const height = 126;
    const x = Phaser.Math.Clamp(this.scene.scale.width / 2 - width / 2, 8, this.scene.scale.width - width - 8);
    const y = Phaser.Math.Clamp(this.scene.scale.height / 2 - height / 2, 8, this.scene.scale.height - height - 8);
    this.inventoryContextMenu.add(this.scene.add.rectangle(x + width / 2, y + height / 2, width, height, 0x111a14, 0.99)
      .setStrokeStyle(1, TRIM, 0.95));
    this.text(this.inventoryContextMenu, x + 12, y + 9, 'เลือกจำนวนที่จะทิ้ง', 12, TEXT);
    this.inventoryContextMenu.add(this.scene.add.rectangle(x + width / 2, y + 52, width - 24, 32, 0x28382d, 1)
      .setStrokeStyle(1, TRIM, 0.8));
    this.text(this.inventoryContextMenu, x + width / 2, y + 43,
      this.quantityInputValue, 12, '#f0d27b').setOrigin(0.5, 0);
    this.text(this.inventoryContextMenu, x + 12, y + 70,
      `กรอกจำนวน 1–${this.contextDropMaximum} แล้วกด Enter`, 9, MUTED);
    this.text(this.inventoryContextMenu, x + 116, y + 101, 'ยกเลิก', 10, MUTED).setOrigin(0.5, 0);
    this.text(this.inventoryContextMenu, x + 170, y + 101, 'ทิ้ง', 10, '#f0d27b').setOrigin(0.5, 0);
    this.inventoryContextMenu.setData('menuBounds', { x, y, width, height, mode: 'quantity' });
    this.inventoryContextMenu.setVisible(true);
  }

  private readonly onQuantityKeyDown = (event: KeyboardEvent) => {
    const bounds = this.inventoryContextMenu.getData('menuBounds') as { mode?: string; x?: number; y?: number } | undefined;
    if (!this.inventoryContextMenu.visible || bounds?.mode !== 'quantity') return;
    event.preventDefault();
    event.stopPropagation();
    if (/^[0-9]$/.test(event.key)) {
      this.quantityInputValue = `${this.quantityInputValue === '0' ? '' : this.quantityInputValue}${event.key}`.slice(0, 4);
      this.refreshDropQuantityPicker();
    } else if (event.key === 'Backspace') {
      this.quantityInputValue = this.quantityInputValue.slice(0, -1);
      this.refreshDropQuantityPicker();
    } else if (event.key === 'Enter' && bounds.x !== undefined && bounds.y !== undefined) {
      this.handleInventoryContextMenuClick(bounds.x + 166, bounds.y + 105);
    } else if (event.key === 'Escape') {
      this.inventoryContextMenu.setVisible(false);
      this.contextMenuItemId = null;
    }
  };

  private refreshDropQuantityPicker() {
    const itemId = this.contextMenuItemId;
    if (itemId) this.openDropQuantityPicker(itemId, this.contextDropMaximum);
  }

  private usePotionFromHotbar(effectType: 'restoreHp' | 'restoreMp') {
    const itemId = effectType === 'restoreHp' ? this.assignedHpPotionId : this.assignedMpPotionId;
    const potion = this.inventoryContents.find((item) => item.itemId === itemId);
    if (!potion) {
      this.setGameMessage(effectType === 'restoreHp' ? 'คลิกขวาโพชั่นในกระเป๋าเพื่อใส่ช่อง HP' : 'คลิกขวาโพชั่นในกระเป๋าเพื่อใส่ช่อง MP');
      return;
    }
    this.useInventoryItem?.(potion.itemId);
  }

  private updatePotionHotbarCounts() {
    if (!this.hpPotionCountLabel || !this.mpPotionCountLabel) return;
    const hpCount = this.inventoryContents.find((item) => item.itemId === this.assignedHpPotionId)?.count ?? 0;
    const mpCount = this.inventoryContents.find((item) => item.itemId === this.assignedMpPotionId)?.count ?? 0;
    this.hpPotionCountLabel.setText(hpCount > 0 ? `×${hpCount}` : '');
    this.mpPotionCountLabel.setText(mpCount > 0 ? `×${mpCount}` : '');
    const hpAssigned = getItemDefinition(this.assignedHpPotionId ?? '');
    const mpAssigned = getItemDefinition(this.assignedMpPotionId ?? '');
    this.hpPotionNameLabel.setText(hpAssigned?.name.slice(0, 6) ?? '');
    this.mpPotionNameLabel.setText(mpAssigned?.name.slice(0, 6) ?? '');
    if (hpAssigned) this.hpPotionIconLabel.setFrame(hpAssigned.iconFrame);
    if (mpAssigned) this.mpPotionIconLabel.setFrame(mpAssigned.iconFrame);
    this.hpPotionIconLabel.setVisible(Boolean(hpAssigned));
    this.mpPotionIconLabel.setVisible(Boolean(mpAssigned));
  }

  private onInventoryWheel(
    pointer: Phaser.Input.Pointer,
    _over: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ) {
    if (deltaY === 0 || this.windowAt(pointer.x, pointer.y) !== 'inventory') return;
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const offset = this.windowOffsets.get('inventory') ?? { x: 0, y: 0 };
    const localX = pointer.x - offset.x;
    const localY = pointer.y - offset.y;
    const { cardWidth, cardHeight } = this.cardSize('inventory', width, height);
    const cardLeft = width / 2 - cardWidth / 2;
    const cardTop = height / 2 - cardHeight / 2;
    const itemsX = cardLeft + 292;
    const itemsWidth = cardWidth - 310;
    const { cell, gap, rows } = this.inventoryGridDimensions(itemsWidth, cardHeight - 110);
    const gridX = itemsX + 16;
    const gridY = cardTop + 62 + 62;
    const gridWidth = 7 * (cell + gap) - gap;
    const gridHeight = rows * (cell + gap) - gap;
    if (!withinRect(localX, localY, gridX, gridY, gridWidth, gridHeight)) return;
    const maxScrollRow = Math.ceil(INVENTORY_SLOT_CAPACITY / 7) - rows;
    const next = Phaser.Math.Clamp(this.inventoryScrollRow + Math.sign(deltaY), 0, maxScrollRow);
    if (next === this.inventoryScrollRow) return;
    this.inventoryScrollRow = next;
    this.renderPage(width, height, 'inventory');
  }

  private inventoryGridDimensions(itemsWidth: number, paneHeight: number) {
    const cell = Math.min(64, (itemsWidth - 60) / 7);
    const gap = 7;
    const rows = Phaser.Math.Clamp(Math.floor((paneHeight - 62 - 94 + gap) / (cell + gap)), 1, 4);
    return { cell, gap, rows };
  }

  private footerButton(x: number, y: number, width: number, label: string, primary: boolean) {
    this.modal.add(this.scene.add.rectangle(x, y, width, 34, primary ? 0x506d50 : 0x344437, 1)
      .setStrokeStyle(1, TRIM, 0.85));
    this.text(this.modal, x, y - 9, label, 13, TEXT).setOrigin(0.5, 0);
  }

  private renderAttributeTooltip(width: number, cardWidth: number, cardTop: number, attribute: AttributeKey) {
    const cardLeft = width / 2 - cardWidth / 2;
    const rowIndex: Record<AttributeKey, number> = { STR: 0, DEX: 1, VIT: 2, INT: 3 };
    const tooltipWidth = 210;
    const tooltipHeight = 46;
    const rightX = cardLeft + cardWidth + 8;
    const leftX = cardLeft - tooltipWidth - 8;
    const x = rightX + tooltipWidth <= width - 8 ? rightX : leftX >= 8 ? leftX : cardLeft + cardWidth - tooltipWidth - 8;
    const y = cardTop + 118 + rowIndex[attribute] * 32;
    this.modal.add(this.scene.add.rectangle(x + tooltipWidth / 2, y + tooltipHeight / 2,
      tooltipWidth, tooltipHeight, 0x101913, 0.98).setStrokeStyle(1, TRIM, 0.9));
    const details: Record<AttributeKey, string> = {
      STR: 'โจมตีกายภาพ +2 ต่อแต้ม',
      DEX: 'คริติคอล +0.5% · ความเร็วโจมตี +1%',
      VIT: 'HP สูงสุด +10 · ป้องกัน +1',
      INT: 'MP สูงสุด +10 · โจมตีเวท +2',
    };
    this.text(this.modal, x + 9, y + 14, details[attribute], 10, TEXT);
  }

  private hotbarSlot(x: number, key: string, icon: string, color: string) {
    const slot = this.scene.add.rectangle(x + 23, 31, 46, 54, 0x202a23, 0.98)
      .setStrokeStyle(1, 0x927f5d, 0.9);
    this.hotbar.add(slot);
    if (icon) this.text(this.hotbar, x + 23, 7, icon, 20, color).setOrigin(0.5, 0);
    this.text(this.hotbar, x + 23, 39, key, 10, TEXT).setOrigin(0.5, 0);
    return slot;
  }

  private bar(container: Phaser.GameObjects.Container, x: number, y: number, width: number, height: number, color: number, label: string) {
    container.add(this.scene.add.rectangle(x + width / 2, y + height / 2, width, height, 0x101713, 1)
      .setStrokeStyle(1, 0x9d895a, 0.75));
    const fill = this.scene.add.rectangle(x + 2, y + height / 2, width - 4, height - 4, color, 0.88)
      .setOrigin(0, 0.5);
    container.add(fill);
    this.text(container, x + 5, y + 1, label, 9, '#fff5df');
    return fill;
  }

  private updateStatusView(snapshot: CharacterStatusSnapshot) {
    this.levelLabel.setText(`Lv. ${snapshot.level}`);
    this.experienceLabel.setText(`EXP ${snapshot.experience} / ${snapshot.experienceToNext}`);
    this.hpFill.setScale(snapshot.currentHp / snapshot.derived.maxHp, 1);
    this.mpFill.setScale(snapshot.currentMp / snapshot.derived.maxMp, 1);
    this.hpValueLabel.setText(`${snapshot.currentHp} / ${snapshot.derived.maxHp}`);
    this.mpValueLabel.setText(`${snapshot.currentMp} / ${snapshot.derived.maxMp}`);
    this.experienceFill.setScale(snapshot.experience / snapshot.experienceToNext, 1);
    if (this.openWindows.has('status')) this.renderPage(this.scene.scale.width, this.scene.scale.height, 'status');
  }

  private panel(container: Phaser.GameObjects.Container, x: number, y: number, width: number, height: number, color = PANEL, border = TRIM) {
    container.add(this.scene.add.rectangle(x + width / 2, y + height / 2, width, height, color, 0.9)
      .setStrokeStyle(1, border, 0.78));
  }

  private text(container: Phaser.GameObjects.Container, x: number, y: number, value: string, size: number, color: string) {
    const label = this.scene.add.text(x, y, value, {
      fontFamily: 'system-ui, "Segoe UI Symbol", sans-serif',
      fontSize: `${size}px`,
      color,
      resolution: 2,
    });
    container.add(label);
    return label;
  }
}
