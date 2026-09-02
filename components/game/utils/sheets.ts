import * as Phaser from "phaser";
import { buildSpriteFrames } from "./MapHelpers";

/**
 * Makes sure a character sheet is a texture the scene can use.
 *
 * Library sheets are loaded at boot. Anything picked from the roster later —
 * an upload made a minute ago, or a seat assigned a look while the game is
 * running — arrives here. Loaded the same way the library ones are, as an
 * image sliced by buildSpriteFrames, so Worker and Player treat every sheet
 * identically and never try to slice frames twice.
 */
export function ensureSheet(
  scene: Phaser.Scene,
  key: string,
  path: string,
  onReady: (ok: boolean) => void,
) {
  if (scene.textures.exists(key)) {
    onReady(true);
    return;
  }
  scene.load.image(key, path);
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    const ok = scene.textures.exists(key);
    if (ok) buildSpriteFrames(scene, key);
    onReady(ok);
  });
  scene.load.start();
}
