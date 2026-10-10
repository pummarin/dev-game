/** Central registry for monster balance and per-map spawn data. Item definitions live in Item Hub. */

/**
 * Base stat block at level 1 — tune these to set the monster's identity.
 * Every stat scales up with level via deriveMonsterStats().
 *
 * STR  → physical attack damage
 * VIT  → max HP and physical defense
 * AGI  → movement speed, attack cooldown, and aggro/chase range
 */
export type MonsterStats = {
  STR: number;
  VIT: number;
  AGI: number;
};

/** Derived values computed from the stat block at a given level — used by MonsterHub at runtime. */
export type MonsterDerived = {
  level: number;
  maxHp: number;
  attack: number;
  defense: number;
  /** Movement speed in px/s */
  moveSpeed: number;
  /** Attack swing cooldown in ms */
  attackCooldown: number;
  /** Aggro trigger distance in H units */
  aggroRange: number;
  /** Chase give-up distance in H units */
  chaseRange: number;
  /** Melee hit range in H units */
  attackRange: number;
  /** EXP awarded on defeat */
  experience: number;
};

/**
 * Monster combat behavior:
 *
 * passive    — never attacks; flees from the player when approached or hit
 * neutral    — ignores the player until attacked; retaliates and chases back
 * aggressive — charges the player on sight within aggroRange; always hostile
 */
export type MonsterBehavior = 'passive' | 'neutral' | 'aggressive';

export type MonsterDefinition = {
  id: string;
  name: string;
  texture: string;
  /** Base stats at level 1. All values scale linearly with level. */
  stats: MonsterStats;
  behavior: MonsterBehavior;
  /** Base experience at level 1. Scales with level. */
  experience: number;
  displaySize: number;
  dropTableId: string;
  currencyDrop: { min: number; max: number };
  /** How long in seconds before this monster respawns after being defeated. Defaults to 8. */
  respawnDelaySec?: number;
};

/**
 * Compute runtime values from a monster's level-1 stat block at a given level.
 * Growth per level: HP +18%, ATK +15%, DEF +10%, Speed +2%, Cooldown -2%.
 */
export function deriveMonsterStats(stats: MonsterStats, level: number): MonsterDerived {
  const { STR, VIT, AGI } = stats;
  const lvl = Math.max(1, Math.floor(level));
  const g = lvl - 1; // growth steps above 1
  return {
    level:         lvl,
    maxHp:         Math.round((20 + VIT * 8)   * (1 + g * 0.18)),
    attack:        Math.round((3  + STR * 1.5)  * (1 + g * 0.15)),
    defense:       Math.round((VIT * 0.5)       * (1 + g * 0.10)),
    moveSpeed:     Math.round((40 + AGI * 4)    * (1 + g * 0.02)),
    attackCooldown: Math.max(500, Math.round((2000 - AGI * 60) * (1 - g * 0.02))),
    aggroRange:    1.8 + AGI * 0.08,
    chaseRange:    3.5 + AGI * 0.12,
    attackRange:   1.0 + STR * 0.02,
    experience:    Math.round(100 * (1 + g * 0.20)),
  };
}

/** Drop rate is a percentage from 0 to 100, rolled independently for each entry. */
export type DropEntry = { itemId: string; dropRate: number; min: number; max: number };
export type MonsterSpawn = {
  id: string;
  monsterId: string;
  mapId: string;
  xH: number;
  yH: number;
  /** Number of monsters to spawn at this point. Defaults to 1. */
  count?: number;
  /** Random scatter radius in H units applied to each spawned monster. Defaults to 0.8. */
  spreadH?: number;
  /**
   * Level range [min, max] — each monster rolls a random level within this range.
   * Omit to use level 1.
   * Example: [2, 4] spawns monsters between Lv.2 and Lv.4.
   */
  levelRange?: [number, number];
};

export const MONSTERS: Record<string, MonsterDefinition> = {
  mossling: {
    id: 'mossling',
    name: 'มอสลิง',
    texture: 'monster-mossling',
    // Base stats at Lv.1 — HP≈36, ATK≈8, DEF≈1, Speed≈52px/s, Cooldown≈1820ms
    stats: { STR: 3, VIT: 2, AGI: 3 },
    behavior: 'aggressive',
    experience: 100,
    displaySize: 94,
    dropTableId: 'mossling-common',
    currencyDrop: { min: 5, max: 12 },
    respawnDelaySec: 8,
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
  // SE of plaza, clear of buildings — map is 30×20C
  { id: 'frontier-town-mossling-test', monsterId: 'mossling', mapId: 'frontier-town', xH: 21, yH: 15, count: 3, spreadH: 1.2, levelRange: [1, 3] },
];
