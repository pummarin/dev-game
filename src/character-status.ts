import type { EquipmentBonuses } from './items/item-registry';

export type AttributeKey = 'STR' | 'DEX' | 'VIT' | 'INT';

type DerivedStatus = {
  maxHp: number;
  maxMp: number;
  physicalAttack: number;
  magicAttack: number;
  physicalDefense: number;
  criticalChance: number;
  criticalDamage: number;
  attackSpeed: number;
  movementSpeed: number;
};

export type CharacterStatusSnapshot = {
  level: number;
  experience: number;
  experienceToNext: number;
  availablePoints: number;
  pendingPoints: number;
  hasPending: boolean;
  attributes: Record<AttributeKey, number>;
  draftAttributes: Record<AttributeKey, number>;
  currentHp: number;
  currentMp: number;
  derived: DerivedStatus;
  previewDerived: DerivedStatus;
};

const ATTRIBUTE_KEYS: AttributeKey[] = ['STR', 'DEX', 'VIT', 'INT'];
export const CHARACTER_POINTS_PER_LEVEL = 5;

/** Prototype character progression. Numerical combat coefficients are centralized for balancing. */
export class CharacterStatus {
  private level = 1;
  private experience = 0;
  private availablePoints = 5;
  private attributes: Record<AttributeKey, number> = { STR: 5, DEX: 5, VIT: 5, INT: 5 };
  private draftAttributes: Record<AttributeKey, number> = { ...this.attributes };
  private pendingPoints = 0;
  private currentHp = 0;
  private currentMp = 0;
  private readonly movementBonuses = new Map<string, number>();
  private readonly equipmentBonuses = new Map<string, EquipmentBonuses>();
  private readonly listeners = new Set<(snapshot: CharacterStatusSnapshot) => void>();

  constructor() {
    const { maxHp, maxMp } = this.derived(this.attributes);
    this.currentHp = maxHp;
    this.currentMp = maxMp;
  }

  snapshot(): CharacterStatusSnapshot {
    return {
      level: this.level,
      experience: this.experience,
      experienceToNext: this.level * 100,
      availablePoints: this.availablePoints - this.pendingPoints,
      pendingPoints: this.pendingPoints,
      hasPending: this.pendingPoints > 0,
      attributes: { ...this.attributes },
      draftAttributes: { ...this.draftAttributes },
      currentHp: this.currentHp,
      currentMp: this.currentMp,
      derived: this.derived(this.attributes),
      previewDerived: this.derived(this.draftAttributes),
    };
  }

  subscribe(listener: (snapshot: CharacterStatusSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  grantExperience(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    this.experience += Math.floor(amount);
    let levelsGained = 0;
    while (this.experience >= this.level * 100) {
      this.experience -= this.level * 100;
      this.level++;
      this.availablePoints += CHARACTER_POINTS_PER_LEVEL;
      levelsGained++;
      const { maxHp, maxMp } = this.derived(this.attributes);
      this.currentHp = maxHp;
      this.currentMp = maxMp;
    }
    this.emit();
    return levelsGained;
  }

  restoreHp(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const before = this.currentHp;
    this.currentHp = Math.min(this.derived(this.attributes).maxHp, this.currentHp + Math.floor(amount));
    const restored = this.currentHp - before;
    if (restored > 0) this.emit();
    return restored;
  }

  restoreMp(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const before = this.currentMp;
    this.currentMp = Math.min(this.derived(this.attributes).maxMp, this.currentMp + Math.floor(amount));
    const restored = this.currentMp - before;
    if (restored > 0) this.emit();
    return restored;
  }

  stageAllocate(attribute: AttributeKey) {
    if (!ATTRIBUTE_KEYS.includes(attribute) || this.availablePoints - this.pendingPoints <= 0) return false;
    this.pendingPoints++;
    this.draftAttributes[attribute]++;
    this.emit();
    return true;
  }

  stageDeallocate(attribute: AttributeKey) {
    if (!ATTRIBUTE_KEYS.includes(attribute) || this.draftAttributes[attribute] <= this.attributes[attribute]) return false;
    this.pendingPoints--;
    this.draftAttributes[attribute]--;
    this.emit();
    return true;
  }

  confirmAllocation() {
    if (this.pendingPoints <= 0) return false;
    this.attributes = { ...this.draftAttributes };
    this.availablePoints -= this.pendingPoints;
    this.pendingPoints = 0;
    const derived = this.derived(this.attributes);
    this.currentHp = Math.min(this.currentHp, derived.maxHp);
    this.currentMp = Math.min(this.currentMp, derived.maxMp);
    this.emit();
    return true;
  }

  discardAllocation() {
    if (this.pendingPoints <= 0) return false;
    this.draftAttributes = { ...this.attributes };
    this.pendingPoints = 0;
    this.emit();
    return true;
  }

  /** Set an additive movement-speed bonus by source, such as equipment, accessory, buff, or potion. */
  setMovementBonus(source: string, amount: number) {
    if (!source.trim() || !Number.isFinite(amount)) return;
    if (amount === 0) this.movementBonuses.delete(source);
    else this.movementBonuses.set(source, amount);
    this.emit();
  }

  /** Replace the additive derived-stat bonuses supplied by one equipment slot. */
  setEquipmentBonus(source: string, bonuses: EquipmentBonuses | undefined) {
    if (!source.trim()) return;
    if (!bonuses || Object.values(bonuses).every((amount) => !amount)) this.equipmentBonuses.delete(source);
    else this.equipmentBonuses.set(source, { ...bonuses });
    const derived = this.derived(this.attributes);
    this.currentHp = Math.min(this.currentHp, derived.maxHp);
    this.currentMp = Math.min(this.currentMp, derived.maxMp);
    this.emit();
  }

  private derived(attributes: Record<AttributeKey, number>): DerivedStatus {
    const { STR, DEX, VIT, INT } = attributes;
    const equipment = [...this.equipmentBonuses.values()].reduce<DerivedStatus>((total, bonus) => ({
      maxHp: total.maxHp + (bonus.maxHp ?? 0),
      maxMp: total.maxMp + (bonus.maxMp ?? 0),
      physicalAttack: total.physicalAttack + (bonus.physicalAttack ?? 0),
      magicAttack: total.magicAttack + (bonus.magicAttack ?? 0),
      physicalDefense: total.physicalDefense + (bonus.physicalDefense ?? 0),
      criticalChance: total.criticalChance + (bonus.criticalChance ?? 0),
      criticalDamage: total.criticalDamage + (bonus.criticalDamage ?? 0),
      attackSpeed: total.attackSpeed + (bonus.attackSpeed ?? 0),
      movementSpeed: total.movementSpeed + (bonus.movementSpeed ?? 0),
    }), {
      maxHp: 0, maxMp: 0, physicalAttack: 0, magicAttack: 0, physicalDefense: 0,
      criticalChance: 0, criticalDamage: 0, attackSpeed: 0, movementSpeed: 0,
    });
    return {
      maxHp: 100 + VIT * 10 + equipment.maxHp,
      maxMp: 50 + INT * 10 + equipment.maxMp,
      physicalAttack: 10 + STR * 2 + equipment.physicalAttack,
      magicAttack: 10 + INT * 2 + equipment.magicAttack,
      physicalDefense: VIT + equipment.physicalDefense,
      criticalChance: Math.min(75, 5 + DEX * 0.5 + equipment.criticalChance),
      criticalDamage: 150 + equipment.criticalDamage,
      attackSpeed: Math.min(150, 100 + DEX + equipment.attackSpeed),
      movementSpeed: Math.max(1, 220 + [...this.movementBonuses.values()].reduce((sum, value) => sum + value, 0) + equipment.movementSpeed),
    };
  }

  private emit() {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
