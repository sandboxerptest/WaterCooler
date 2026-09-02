import * as Phaser from "phaser";
import { SPRITE_KEY, FRAME_HEIGHT } from "../config/animations";
import { ensureAnims } from "../utils/sheets";
import { ChatBubble } from "./ChatBubble";
import type { PresencePlayer } from "@/lib/presence-types";

/**
 * Another human in the office.
 *
 * Positions arrive twenty times a second, which is choppy if applied directly,
 * so the sprite eases toward the last reported position instead of snapping to
 * it. Remote players carry no physics body: the server is the authority on
 * where they are, and colliding with a ghost of stale data feels worse than
 * walking through each other.
 */

/** How quickly the sprite closes the gap to its reported position. */
const INTERPOLATION_MS = 100;

/** Beyond this the player is treated as having warped — snap rather than glide. */
const SNAP_DISTANCE = 220;

export class RemotePlayer {
  readonly id: string;
  name: string;
  private sprite: Phaser.GameObjects.Sprite;
  private nameTag: Phaser.GameObjects.Text;
  private targetX: number;
  private targetY: number;
  private facing: PresencePlayer["facing"] = "down";
  private moving = false;
  private currentAnim = "";
  /** "<sheet>:" when wearing something other than the default sheet. */
  private prefix = "";
  private bubble: ChatBubble;

  constructor(scene: Phaser.Scene, player: PresencePlayer) {
    this.id = player.id;
    this.name = player.name;
    this.targetX = player.x;
    this.targetY = player.y;

    this.sprite = scene.add.sprite(player.x, player.y, SPRITE_KEY, 0);
    this.sprite.setDepth(5);
    this.wear(player.spriteKey);

    this.nameTag = scene.add
      .text(player.x, player.y + FRAME_HEIGHT / 2 + 2, player.name, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: "8px",
        color: "#ffe9a8",
        backgroundColor: "rgba(0,0,0,0.7)",
        padding: { x: 4, y: 2 },
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setDepth(20);

    this.bubble = new ChatBubble(scene);
    this.applyAnimation(player.facing, false);
  }

  /** Show what this person just said, above their head. */
  say(text: string, ttl = 6000) {
    this.bubble.show(text, this.sprite.x, this.sprite.y - FRAME_HEIGHT * 0.6, ttl);
  }

  /** Latest report from the server. */
  setTarget(player: PresencePlayer) {
    this.targetX = player.x;
    this.targetY = player.y;
    this.moving = player.moving;

    if (player.name !== this.name) {
      this.name = player.name;
      this.nameTag.setText(player.name);
    }
    this.wear(player.spriteKey);

    this.applyAnimation(player.facing, player.moving);
  }

  update(deltaMs: number) {
    const dx = this.targetX - this.sprite.x;
    const dy = this.targetY - this.sprite.y;

    if (Math.hypot(dx, dy) > SNAP_DISTANCE) {
      this.sprite.setPosition(this.targetX, this.targetY);
    } else {
      const t = Math.min(1, deltaMs / INTERPOLATION_MS);
      this.sprite.setPosition(this.sprite.x + dx * t, this.sprite.y + dy * t);
    }

    this.nameTag.setPosition(this.sprite.x, this.sprite.y + FRAME_HEIGHT / 2 + 2);
    this.bubble.updatePosition(this.sprite.x, this.sprite.y - FRAME_HEIGHT * 0.6);
  }

  /**
   * Look like the sheet they chose, when this scene has it loaded. Library
   * sheets always are; a sheet this browser has never fetched falls back to
   * the default look rather than a blank.
   */
  private wear(spriteKey: string) {
    const scene = this.sprite.scene;
    const key =
      spriteKey !== SPRITE_KEY && scene.textures.exists(spriteKey) ? spriteKey : SPRITE_KEY;
    const prefix = key === SPRITE_KEY ? "" : `${key}:`;
    if (prefix === this.prefix && this.sprite.texture.key === key) return;
    if (key !== SPRITE_KEY) ensureAnims(scene, key);
    this.prefix = prefix;
    this.currentAnim = "";
    this.sprite.setTexture(key, 0);
    this.applyAnimation(this.facing, this.moving);
  }

  private applyAnimation(facing: PresencePlayer["facing"], moving: boolean) {
    this.facing = facing;
    const key = `${this.prefix}${moving ? "walk" : "idle"}-${facing}`;
    if (key === this.currentAnim) return;
    if (!this.sprite.scene.anims.exists(key)) return;
    this.currentAnim = key;
    this.sprite.anims.play(key, true);
  }

  destroy() {
    this.bubble.destroy();
    this.sprite.destroy();
    this.nameTag.destroy();
  }
}
