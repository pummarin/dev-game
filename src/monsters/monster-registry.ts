/** Central registry for monster balance and per-map spawn data. Item definitions live in Item Hub. */
export type MonsterDefinition = {
  id: string;
  name: string;
  texture: string;
  hp: number;
  experience: number;
  attackDamage: number;
  passive: boolean;
  displaySize: number;
  dropTableId: string;
  currencyDrop: { min: number; max: number };
};

/** Drop rate is a percentage from 0 to 100, rolled independently for each entry. */
export type DropEntry = { itemId: string; dropRate: number; min: number; max: number };
export type MonsterSpawn = { id: string; monsterId: string; mapId: string; xH: number; yH: number };

export const MONSTERS: Record<string, MonsterDefinition> = {
  mossling: {
    id: 'mossling', name: 'มอสลิง', texture: 'monster-mossling', hp: 30,
    experience: 100, attackDamage: 0, passive: true, displaySize: 94, dropTableId: 'mossling-common', currencyDrop: { min: 5, max: 12 },
  },
};

export const DROP_TABLES: Record<string, DropEntry[]> = {
  'mossling-common': [
    { itemId: 'mossFragment', dropRate: 100, min: 1, max: 1 },
    { itemId: 'healthPotion', dropRate: 35, min: 1, max: 1 },
    // Prototype gear drop so the rarity roll and tier-scaled stats can be tried in-game.
    { itemId: 'trainingSword', dropRate: 100, min: 1, max: 1 },
  ],
};

/** Exactly one harmless test target in the town plaza. Add map spawns here as content expands. */
export const MONSTER_SPAWNS: MonsterSpawn[] = [
  { id: 'frontier-town-mossling-test', monsterId: 'mossling', mapId: 'frontier-town', xH: 30, yH: 18 },
];
