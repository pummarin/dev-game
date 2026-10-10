import Phaser from 'phaser';

export type MapExitDefinition = {
  id: string;
  targetSceneKey: string;
  triggerH: [x: number, y: number, width: number, height: number];
  arrivalSpawnId: string;
};

export type MapSceneStartData = {
  spawnId: string;
  fromSceneKey: string;
};

export type MapExitResult = 'outside' | 'destination-missing' | 'started';

/** Routes a map exit only when its destination scene has been registered in Phaser. */
export class MapTransitionRouter {
  private activeExitId: string | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  update(pointH: [number, number], exits: MapExitDefinition[]): MapExitResult {
    const exit = exits.find(({ triggerH }) => {
      const [x, y, width, height] = triggerH;
      return pointH[0] >= x && pointH[0] <= x + width && pointH[1] >= y && pointH[1] <= y + height;
    });
    if (!exit) {
      this.activeExitId = null;
      return 'outside';
    }
    const destinationExists = Boolean(this.scene.game.scene.keys[exit.targetSceneKey]);
    if (exit.id === this.activeExitId) return destinationExists ? 'outside' : 'destination-missing';
    this.activeExitId = exit.id;
    if (!destinationExists) return 'destination-missing';
    this.scene.scene.start(exit.targetSceneKey, {
      spawnId: exit.arrivalSpawnId,
      fromSceneKey: this.scene.scene.key,
    } satisfies MapSceneStartData);
    return 'started';
  }
}
