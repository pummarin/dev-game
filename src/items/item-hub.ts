import type { CharacterStatus } from '../character-status';
import { getItemDefinition, getItemRarity, getItemStatBonuses, INVENTORY_SLOT_CAPACITY, makeItemInstanceId, type EquipmentSlot, type ItemCategory, type ItemRarity } from './item-registry';

export type InventoryStack = {
  itemId: string;
  name: string;
  description: string;
  count: number;
  category: ItemCategory;
  rarity: ItemRarity;
};

export type EquipmentStack = { slot: EquipmentSlot; itemId: string; name: string; rarity: ItemRarity; statBonuses?: ReturnType<typeof getItemStatBonuses> };

/** Owns item stacking, capacity, inventory snapshots, drops from inventory, and consumable use. */
export class ItemHub {
  private readonly stacks = new Map<string, number>();
  private readonly equipped = new Map<EquipmentSlot, string>();
  private currency = 0;

  currencySnapshot() {
    return this.currency;
  }

  addCurrency(amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) return false;
    this.currency += amount;
    return true;
  }

  spendCurrency(amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || this.currency < amount) return false;
    this.currency -= amount;
    return true;
  }

  snapshot(): InventoryStack[] {
    return [...this.stacks.entries()].flatMap(([itemId, count]) => {
      const item = getItemDefinition(itemId);
      return item ? [{ itemId, name: item.name, description: item.description, count, category: item.category, rarity: getItemRarity(itemId) }] : [];
    });
  }

  canAdd(itemId: string) {
    return Boolean(getItemDefinition(itemId)) && (this.stacks.has(itemId) || this.stacks.size < INVENTORY_SLOT_CAPACITY);
  }

  add(itemId: string, amount: number) {
    const item = getItemDefinition(itemId);
    const stackId = item?.category === 'equipment' && !itemId.includes('::') ? makeItemInstanceId(itemId, item.rarity) : itemId;
    if (!stackId || !this.canAdd(stackId) || !Number.isInteger(amount) || amount <= 0) return false;
    this.stacks.set(stackId, (this.stacks.get(stackId) ?? 0) + amount);
    return true;
  }

  remove(itemId: string, amount: number) {
    const count = this.stacks.get(itemId) ?? 0;
    if (!Number.isInteger(amount) || amount <= 0 || count < amount) return false;
    const remaining = count - amount;
    if (remaining > 0) this.stacks.set(itemId, remaining);
    else this.stacks.delete(itemId);
    return true;
  }

  equipmentSnapshot(): EquipmentStack[] {
    return [...this.equipped.entries()].flatMap(([slot, itemId]) => {
      const item = getItemDefinition(itemId);
      return item ? [{ slot, itemId, name: item.name, rarity: getItemRarity(itemId), statBonuses: getItemStatBonuses(itemId) }] : [];
    });
  }

  equip(itemId: string, status: CharacterStatus): { success: boolean; message: string } {
    const item = getItemDefinition(itemId);
    const requestedSlot = item?.equipmentSlot;
    if (!item || item.category !== 'equipment' || !requestedSlot || (this.stacks.get(itemId) ?? 0) <= 0) {
      return { success: false, message: 'ไอเทมนี้สวมใส่ไม่ได้' };
    }
    const slot: EquipmentSlot | undefined = requestedSlot === 'ring'
      ? !this.equipped.has('ring1') ? 'ring1' : !this.equipped.has('ring2') ? 'ring2' : undefined
      : requestedSlot;
    if (!slot) return { success: false, message: 'ช่องแหวนเต็มแล้ว · ถอดแหวนวงใดวงหนึ่งก่อน' };
    const previousItemId = this.equipped.get(slot);
    if (previousItemId === itemId) return { success: false, message: `${item.name} สวมอยู่แล้ว` };
    if (previousItemId && !this.stacks.has(previousItemId) && this.stacks.size >= INVENTORY_SLOT_CAPACITY && (this.stacks.get(itemId) ?? 0) > 1) {
      return { success: false, message: 'กระเป๋าเต็ม จึงสลับอุปกรณ์ไม่ได้' };
    }
    this.remove(itemId, 1);
    if (previousItemId) this.add(previousItemId, 1);
    this.equipped.set(slot, itemId);
    status.setEquipmentBonus(`equipment:${slot}`, getItemStatBonuses(itemId));
    return { success: true, message: `สวมใส่ ${item.name} แล้ว` };
  }

  unequip(slot: EquipmentSlot, status: CharacterStatus): { success: boolean; message: string } {
    const itemId = this.equipped.get(slot);
    const item = itemId ? getItemDefinition(itemId) : undefined;
    if (!itemId || !item) return { success: false, message: 'ช่องนี้ไม่มีอุปกรณ์' };
    if (!this.canAdd(itemId)) return { success: false, message: 'กระเป๋าเต็ม จึงถอดอุปกรณ์ไม่ได้' };
    this.equipped.delete(slot);
    this.add(itemId, 1);
    status.setEquipmentBonus(`equipment:${slot}`, undefined);
    return { success: true, message: `ถอด ${item.name} แล้ว` };
  }

  use(itemId: string, status: CharacterStatus): { success: boolean; message: string } {
    const item = getItemDefinition(itemId);
    if (!item || item.category !== 'consumable' || !item.useEffect || (this.stacks.get(itemId) ?? 0) <= 0) {
      return { success: false, message: 'ไอเทมนี้ยังไม่มีผลการใช้งาน' };
    }
    const restored = item.useEffect.type === 'restoreHp'
      ? status.restoreHp(item.useEffect.amount)
      : status.restoreMp(item.useEffect.amount);
    if (restored <= 0) return { success: false, message: 'ค่าสถานะเต็มแล้ว จึงยังไม่ได้ใช้ไอเทม' };
    this.remove(itemId, 1);
    const stat = item.useEffect.type === 'restoreHp' ? 'HP' : 'MP';
    return { success: true, message: `ใช้ ${item.name} · ฟื้นฟู ${stat} ${restored}` };
  }
}
