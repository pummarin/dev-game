import Phaser from 'phaser';
import type { CharacterStatus } from '../character-status';
import type { TravelerController } from '../traveler-controller';
import { ItemHub, type EquipmentStack, type InventoryStack } from '../items/item-hub';
import { getItemDefinition, INVENTORY_SLOT_CAPACITY, rollEquipmentRarity, makeItemInstanceId, TEST_EQUIPMENT_ITEM_IDS, type EquipmentSlot } from '../items/item-registry';
import { DROP_TABLES, MONSTERS, MONSTER_SPAWNS, type MonsterDefinition, type MonsterSpawn } from './monster-registry';

export const MONSTER_TEXTURES = [{ key: 'monster-mossling', url: '/assets/monsters/mossling-prototype.png' }];
const MONSTER_OVERLAY_DEPTH = 200_000;

type LiveMonster = {
  spawn: MonsterSpawn;
  definition: MonsterDefinition;
  sprite: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  hpBack: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  hp: number;
  respawnAt: number | null;
  selection: Phaser.GameObjects.Ellipse;
};
type WorldDrop = {
  kind: 'item' | 'currency';
  itemId: string;
  count: number;
  currencyAmount?: number;
  x: number;
  y: number;
  expiresAt: number;
  icon: Phaser.GameObjects.GameObject;
  label: Phaser.GameObjects.Text;
};
const WORLD_DROP_LIFETIME_MS = 15_000;

/** Runtime hub shared by map scenes; each scene supplies its map id and data-driven H-coordinate spawns. */
export class MonsterHub {
  private readonly monsters: LiveMonster[] = [];
  private readonly drops: WorldDrop[] = [];
  private readonly itemHub = new ItemHub();
  private readonly attackKey: Phaser.Input.Keyboard.Key;
  private readonly pickupKey: Phaser.Input.Keyboard.Key;
  private lockedTarget: LiveMonster | null = null;
  private lastAttackAt = 0;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    mapId: string,
    private readonly pixelsPerH: number,
    private readonly player: Phaser.GameObjects.Sprite,
    private readonly traveler: TravelerController,
    private readonly status: CharacterStatus,
    private readonly onInventoryChanged: (items: InventoryStack[]) => void,
    private readonly onEquipmentChanged: (items: EquipmentStack[]) => void,
    private readonly onCurrencyChanged: (amount: number) => void,
    private readonly onMessage: (message: string) => void,
    private readonly isUiPointerBlocked: (x: number, y: number) => boolean,
  ) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('MonsterHub requires keyboard input');
    this.attackKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.pickupKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    TEST_EQUIPMENT_ITEM_IDS.forEach((itemId) =>
      this.itemHub.add(makeItemInstanceId(itemId, rollEquipmentRarity()), 1));
    this.onInventoryChanged(this.itemHub.snapshot());
    this.onCurrencyChanged(this.itemHub.currencySnapshot());
    MONSTER_SPAWNS.filter((spawn) => spawn.mapId === mapId).forEach((spawn) => this.createMonster(spawn));
    this.onEquipmentChanged(this.itemHub.equipmentSnapshot());
    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  update(time: number) {
    if (this.destroyed) return;
    for (let index = this.drops.length - 1; index >= 0; index -= 1) {
      if (time >= this.drops[index].expiresAt) this.removeWorldDrop(index);
    }
    this.monsters.forEach((monster) => {
      if (monster.respawnAt !== null && time >= monster.respawnAt) this.revive(monster);
      if (monster.sprite.active) {
        monster.sprite.setDepth(1 + monster.sprite.y);
        const height = monster.definition.displaySize * 1153 / 1364;
        monster.name.setPosition(monster.sprite.x, monster.sprite.y - height * 1.22);
        monster.hpBack.setPosition(monster.sprite.x, monster.sprite.y - height * 1.04);
        monster.hpFill.setPosition(monster.sprite.x - 24, monster.sprite.y - height * 1.04);
        monster.name.setDepth(MONSTER_OVERLAY_DEPTH + 2);
        monster.hpBack.setDepth(MONSTER_OVERLAY_DEPTH + 2);
        monster.hpFill.setDepth(MONSTER_OVERLAY_DEPTH + 3);
        monster.selection.setPosition(monster.sprite.x, monster.sprite.y - Math.max(2, height * 0.04));
      }
    });
    if (Phaser.Input.Keyboard.JustDown(this.attackKey)) this.attackNearest(time);
    if (Phaser.Input.Keyboard.JustDown(this.pickupKey)) this.pickupNearest();
    if (this.lockedTarget?.sprite.active) {
      const target = this.lockedTarget;
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, target.sprite.x, target.sprite.y);
      if (this.traveler.hasManualMovementInput) {
        this.traveler.clearMoveTarget();
      } else if (distance > this.pixelsPerH * 1.28) {
        this.traveler.setMoveTarget(target.sprite.x, target.sprite.y, this.pixelsPerH * 1.2);
      } else {
        this.traveler.clearMoveTarget();
        if (time - this.lastAttackAt >= 700) this.performAttack(target, time);
      }
    }
  }

  inventorySnapshot(): InventoryStack[] {
    return this.itemHub.snapshot();
  }

  equipmentSnapshot(): EquipmentStack[] {
    return this.itemHub.equipmentSnapshot();
  }

  currencySnapshot() {
    return this.itemHub.currencySnapshot();
  }

  equipInventoryItem(itemId: string) {
    const result = this.itemHub.equip(itemId, this.status);
    this.onMessage(result.message);
    if (result.success) {
      this.onInventoryChanged(this.inventorySnapshot());
      this.onEquipmentChanged(this.equipmentSnapshot());
    }
    return result.success;
  }

  unequipEquipmentSlot(slot: EquipmentSlot) {
    const result = this.itemHub.unequip(slot, this.status);
    this.onMessage(result.message);
    if (result.success) {
      this.onInventoryChanged(this.inventorySnapshot());
      this.onEquipmentChanged(this.equipmentSnapshot());
    }
    return result.success;
  }

  dropInventoryItem(itemId: string, amount = 1) {
    const item = getItemDefinition(itemId);
    if (!item || !this.itemHub.remove(itemId, amount)) return false;
    this.createWorldDrop(itemId, amount, this.player.x + Phaser.Math.Between(-22, 22), this.player.y + Phaser.Math.Between(-12, 12));
    this.onInventoryChanged(this.inventorySnapshot());
    this.onMessage(`ทิ้ง ${item.name} ×${amount} แล้ว`);
    return true;
  }

  useInventoryItem(itemId: string) {
    const result = this.itemHub.use(itemId, this.status);
    this.onMessage(result.message);
    if (result.success) this.onInventoryChanged(this.inventorySnapshot());
    return result.success;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.monsters.forEach(({ sprite, name, hpBack, hpFill, selection }) => [sprite, name, hpBack, hpFill, selection].forEach((object) => object.destroy()));
    this.drops.forEach(({ icon, label }) => { icon.destroy(); label.destroy(); });
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.keyboard?.removeKey(this.attackKey, true);
    this.scene.input.keyboard?.removeKey(this.pickupKey, true);
  }

  private createMonster(spawn: MonsterSpawn) {
    const definition = MONSTERS[spawn.monsterId];
    const x = spawn.xH * this.pixelsPerH;
    const y = spawn.yH * this.pixelsPerH;
    const displayHeight = definition.displaySize * 1153 / 1364;
    const sprite = this.scene.add.image(x, y, definition.texture)
      .setDisplaySize(definition.displaySize, displayHeight)
      .setOrigin(0.5, 0.88)
      .setDepth(1 + y);
    const name = this.scene.add.text(x, y - displayHeight * 1.22, `${definition.name}  ${definition.hp}/${definition.hp}`, {
      fontFamily: 'system-ui, "Segoe UI", sans-serif', fontSize: '11px', color: '#f4efd9',
      backgroundColor: '#152019dd', padding: { x: 4, y: 2 }, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(MONSTER_OVERLAY_DEPTH + 2);
    const hpY = y - displayHeight * 1.04;
    const hpBack = this.scene.add.rectangle(x, hpY, 54, 8, 0x171411, 1)
      .setStrokeStyle(1, 0xf1e5c8, 0.9).setDepth(MONSTER_OVERLAY_DEPTH + 2);
    const hpFill = this.scene.add.rectangle(x - 24, hpY, 46, 4, 0xe64d45, 1)
      .setOrigin(0, 0.5).setDepth(MONSTER_OVERLAY_DEPTH + 3);
    const selection = this.scene.add.ellipse(
      x, y - Math.max(2, displayHeight * 0.04), definition.displaySize * 0.9, definition.displaySize * 0.22,
    ).setFillStyle(0xd7bb74, 0.04).setStrokeStyle(2, 0xe6c879, 0.82).setVisible(false).setDepth(1 + y + 0.1);
    this.scene.tweens.add({ targets: sprite, y: y - 3, duration: 620, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
    this.monsters.push({ spawn, definition, sprite, name, hpBack, hpFill, hp: definition.hp, respawnAt: null, selection });
  }

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (this.isUiPointerBlocked(pointer.x, pointer.y) || pointer.button !== 0) return;
    const clickedDropIndex = this.drops.findIndex((drop) =>
      Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, drop.x, drop.y) <= 20);
    if (clickedDropIndex >= 0) {
      this.pickupDrop(clickedDropIndex);
      return;
    }
    const clicked = this.monsters.find((monster) => this.isAlive(monster) &&
      Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, monster.sprite.x, monster.sprite.y - monster.definition.displaySize * 0.38)
        <= monster.definition.displaySize * 0.62);
    if (clicked) {
      this.lockTarget(clicked);
      return;
    }
    this.clearTarget();
    this.traveler.setMoveTarget(pointer.worldX, pointer.worldY);
  };

  private lockTarget(monster: LiveMonster) {
    this.clearTarget();
    this.lockedTarget = monster;
    monster.selection.setVisible(true);
    const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, monster.sprite.x, monster.sprite.y);
    if (distance > this.pixelsPerH * 1.28) this.traveler.setMoveTarget(monster.sprite.x, monster.sprite.y, this.pixelsPerH * 1.2);
    else this.traveler.clearMoveTarget();
    this.onMessage(`ล็อกเป้า ${monster.definition.name} · กำลังโจมตีอัตโนมัติ`);
  }

  private clearTarget() {
    this.lockedTarget?.selection.setVisible(false);
    this.lockedTarget = null;
  }

  private attackNearest(time: number) {
    if (time - this.lastAttackAt < 360) return;
    const target = this.lockedTarget && this.isAlive(this.lockedTarget) ? this.lockedTarget : this.monsters.find((monster) => this.isAlive(monster) &&
      Phaser.Math.Distance.Between(this.player.x, this.player.y, monster.sprite.x, monster.sprite.y) <= this.pixelsPerH * 1.65);
    if (!target) {
      this.onMessage('ไม่มีมอนสเตอร์อยู่ใกล้พอ · เข้าใกล้แล้วกด Space');
      return;
    }
    this.performAttack(target, time);
  }

  private performAttack(target: LiveMonster, time: number) {
    if (!this.isAlive(target)) return;
    if (!this.traveler.playAttack(
      () => this.resolveAttackImpact(target),
      { x: target.sprite.x, y: target.sprite.y },
    )) return;
    this.lastAttackAt = time;
  }

  private resolveAttackImpact(target: LiveMonster) {
    if (!this.isAlive(target)) return;
    const baseDamage = 10;
    const derived = this.status.snapshot().derived;
    const criticalChance = derived.criticalChance;
    const isCritical = Math.random() * 100 < criticalChance;
    const damage = isCritical ? Math.round(baseDamage * derived.criticalDamage / 100) : baseDamage;
    target.hp = Math.max(0, target.hp - damage);
    target.hpFill.setScale(target.hp / target.definition.hp, 1);
    target.name.setText(`${target.definition.name}  ${target.hp}/${target.definition.hp}`);
    this.showDamage(target, damage, isCritical);
    this.scene.tweens.add({ targets: target.sprite, alpha: 0.45, duration: 70, yoyo: true, repeat: 1 });
    if (target.hp === 0) this.defeat(target);
  }

  private showDamage(target: LiveMonster, damage: number, isCritical: boolean) {
    const height = target.definition.displaySize * 1153 / 1364;
    const side = Phaser.Math.Between(0, 1) === 0 ? -1 : 1;
    const number = this.scene.add.text(target.sprite.x + side * 50,
      target.sprite.y - height * 1.42, isCritical ? `-${damage} CRIT!` : `-${damage}`, {
        fontFamily: 'system-ui, "Segoe UI", sans-serif', fontSize: isCritical ? '22px' : '18px', fontStyle: 'bold',
        color: isCritical ? '#ffe06a' : '#fff2bf', stroke: '#38271d', strokeThickness: isCritical ? 5 : 4, resolution: 2,
      }).setOrigin(0.5, 0.5).setDepth(MONSTER_OVERLAY_DEPTH + 4);
    this.scene.tweens.add({ targets: number, y: number.y - 18, alpha: 0, duration: 720, ease: 'Cubic.easeOut',
      onComplete: () => number.destroy() });
  }

  private defeat(monster: LiveMonster) {
    if (!monster.sprite.active || !monster.sprite.visible || monster.respawnAt !== null) return;
    // Deactivate immediately so repeat clicks/attacks on the corpse cannot award rewards again.
    monster.sprite.setActive(false);
    monster.sprite.setVisible(false);
    monster.name.setVisible(false);
    monster.hpBack.setVisible(false);
    monster.hpFill.setVisible(false);
    monster.selection.setVisible(false);
    if (this.lockedTarget === monster) {
      this.lockedTarget = null;
      this.traveler.clearMoveTarget();
    }
    monster.respawnAt = this.scene.time.now + 8_000;
    this.status.grantExperience(monster.definition.experience);
    this.rollDrops(monster);
    this.rollCurrencyDrop(monster);
    this.onMessage(`${monster.definition.name} พ่ายแพ้ · ได้รับ EXP ${monster.definition.experience}`);
  }

  private rollDrops(monster: LiveMonster) {
    for (const drop of DROP_TABLES[monster.definition.dropTableId] ?? []) {
      if (Math.random() * 100 >= Phaser.Math.Clamp(drop.dropRate, 0, 100)) continue;
      const count = Phaser.Math.Between(drop.min, drop.max);
      const x = monster.sprite.x + Phaser.Math.Between(-18, 18);
      const y = monster.sprite.y + Phaser.Math.Between(-10, 10);
      const item = getItemDefinition(drop.itemId);
      const droppedItemId = item?.category === 'equipment'
        ? makeItemInstanceId(drop.itemId, rollEquipmentRarity())
        : drop.itemId;
      this.createWorldDrop(droppedItemId, count, x, y);
    }
  }

  private rollCurrencyDrop(monster: LiveMonster) {
    const { min, max } = monster.definition.currencyDrop;
    const amount = Phaser.Math.Between(min, max);
    const x = monster.sprite.x + Phaser.Math.Between(-18, 18);
    const y = monster.sprite.y + Phaser.Math.Between(-10, 10);
    this.createCurrencyDrop(amount, x, y);
  }

  private createWorldDrop(itemId: string, count: number, x: number, y: number) {
    const item = getItemDefinition(itemId);
    if (!item) return;
    const icon = this.scene.add.image(x, y, 'item-icons', item.iconFrame)
      .setDisplaySize(30, 30)
      .setDepth(1 + y)
      .setInteractive({ useHandCursor: true });
    const label = this.scene.add.text(x, y - 16, `${item.name} ×${count}`, {
      fontFamily: 'system-ui, "Segoe UI", sans-serif', fontSize: '10px', color: '#f4efd9',
      backgroundColor: '#152019dd', padding: { x: 3, y: 2 }, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(1_000);
    this.drops.push({ kind: 'item', itemId, count, x, y, expiresAt: this.scene.time.now + WORLD_DROP_LIFETIME_MS, icon, label });
  }

  private createCurrencyDrop(amount: number, x: number, y: number) {
    const coin = this.scene.add.circle(0, 0, 12, 0xc99a36, 1).setStrokeStyle(2, 0xffdf7c, 1);
    const inset = this.scene.add.circle(0, 0, 8, 0xa97524, 1).setStrokeStyle(1, 0xf6cb5c, 1);
    const mark = this.scene.add.text(0, -7, 'G', {
      fontFamily: 'system-ui, "Segoe UI", sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#fff0a8',
    }).setOrigin(0.5, 0);
    const icon = this.scene.add.container(x, y, [coin, inset, mark]).setDepth(1 + y);
    const label = this.scene.add.text(x, y - 16, `ทอง ×${amount}`, {
      fontFamily: 'system-ui, "Segoe UI", sans-serif', fontSize: '10px', color: '#ffe28a',
      backgroundColor: '#152019dd', padding: { x: 3, y: 2 }, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(1_000);
    this.drops.push({ kind: 'currency', itemId: '', count: amount, currencyAmount: amount, x, y, expiresAt: this.scene.time.now + WORLD_DROP_LIFETIME_MS, icon, label });
  }

  private pickupNearest() {
    const index = this.drops.findIndex((drop) => Phaser.Math.Distance.Between(this.player.x, this.player.y, drop.x, drop.y) <= this.pixelsPerH * 1.5);
    if (index < 0) {
      this.onMessage('ไม่มีไอเทมอยู่ใกล้พอ · เข้าใกล้แล้วกด E');
      return;
    }
    this.pickupDrop(index);
  }

  private pickupDrop(index: number) {
    const candidate = this.drops[index];
    if (!candidate) return;
    if (candidate.kind === 'currency') {
      const amount = candidate.currencyAmount ?? candidate.count;
      if (!this.itemHub.addCurrency(amount)) return;
      this.removeWorldDrop(index);
      this.onCurrencyChanged(this.itemHub.currencySnapshot());
      this.onMessage(`เก็บเงิน ${amount} ทองแล้ว`);
      return;
    }
    if (!this.itemHub.canAdd(candidate.itemId)) {
      this.onMessage(`กระเป๋าเต็ม (${INVENTORY_SLOT_CAPACITY} ช่อง)`);
      return;
    }
    const item = getItemDefinition(candidate.itemId);
    if (!item || !this.itemHub.add(candidate.itemId, candidate.count)) return;
    this.removeWorldDrop(index);
    this.onInventoryChanged(this.inventorySnapshot());
    this.onMessage(`เก็บ ${item.name} ×${candidate.count} แล้ว`);
  }

  private removeWorldDrop(index: number) {
    const [drop] = this.drops.splice(index, 1);
    if (!drop) return;
    drop.icon.destroy();
    drop.label.destroy();
  }

  private revive(monster: LiveMonster) {
    monster.hp = monster.definition.hp;
    monster.respawnAt = null;
    monster.sprite.setActive(true).setAlpha(1).setVisible(true);
    monster.name.setText(`${monster.definition.name}  ${monster.hp}/${monster.definition.hp}`).setVisible(true);
    monster.hpBack.setVisible(true);
    monster.hpFill.setScale(1, 1).setVisible(true);
    monster.selection.setVisible(false);
  }

  private isAlive(monster: LiveMonster) {
    return monster.sprite.active && monster.sprite.visible && monster.hp > 0 && monster.respawnAt === null;
  }
}
