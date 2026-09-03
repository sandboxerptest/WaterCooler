import { makeAnims } from "../config/animations";
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

/**
 * The idle and walk animations for a sheet, created once and then reused.
 * The texture must already be loaded.
 */
export function ensureAnims(scene: Phaser.Scene, spriteKey: string) {
  // Nothing to make from a sheet that has not been cut yet; an animation
  // with no frames is worse than none, since it can never be replaced.
  if (!scene.textures.exists(spriteKey) || scene.textures.get(spriteKey).frameTotal <= 1) return;
  for (const anim of [
    ...makeAnims(spriteKey, "idle", 1, 8),
    ...makeAnims(spriteKey, "walk", 2, 10),
  ]) {
    if (scene.anims.exists(anim.key)) continue;
    scene.anims.create({
      key: anim.key,
      frames: scene.anims.generateFrameNumbers(spriteKey, { start: anim.start, end: anim.end }),
      frameRate: anim.frameRate,
      repeat: anim.repeat,
    });
  }
}
