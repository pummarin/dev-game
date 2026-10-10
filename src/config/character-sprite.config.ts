export const CHARACTER_SPRITES = {
  idle: {
    N: 'idle-up',
    S: 'idle-down',
    W: 'idle-left',
    E: 'idle-right',
  },
  walk: {
    N: 'walk-up',
    S: 'walk-down',
    W: 'walk-left',
    E: 'walk-right',
  },
  attack: {
    N: 'attack-up',
    S: 'attack-down',
    W: 'attack-left',
    E: 'attack-right',
  },
} as const;

export const SPRITE_CONFIG = {
  frameWidth: 256,
  frameHeight: 256,
  walkFrameRate: 10,
  attackFrameRate: 10,
} as const;