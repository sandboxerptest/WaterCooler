import * as Phaser from "phaser";
import { Player } from "../entities/Player";
import { resetWanderClock } from "../entities/Worker";
import { SPRITE_KEY, SPRITE_PATH, WORKER_SPRITES, MOVE_SPEED } from "../config/animations";
import { EMOTE_SHEET_KEY, EMOTE_SHEET_PATH, EMOTE_FRAME_SIZE } from "../config/emotes";
import { Pathfinder } from "../utils/Pathfinder";
import {
  buildSpriteFrames,
  parseSpawns,
  parsePOIs,
  buildCollisionRects,
  renderTileObjectLayer,
  type AnimatedProp,
} from "../utils/MapHelpers";
import { gameEvents } from "@/lib/events";
import { createLogger } from "@/lib/logger";
import {
  BOSS_INTERACT_DISTANCE,
  PF_PADDING,
  PRESS_E_STYLE,
  BOSS_PROMPT_OFFSET_X,
  BOSS_PROMPT_OFFSET_Y,
} from "@/lib/constants";

import { CameraController } from "../systems/CameraController";
import { WorkerManager } from "../systems/WorkerManager";
import { InteractionManager } from "../systems/InteractionManager";
import { GamepadInput } from "../systems/GamepadInput";
import { RemotePlayerManager } from "../systems/RemotePlayerManager";
import { DoorManager } from "../systems/DoorManager";
import { initSceneEventBridge } from "../systems/SceneEventBridge";

const log = createLogger("OfficeScene");

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

export class OfficeScene extends Phaser.Scene {
  private player!: Player;
  private terminalZone: { x: number; y: number } | null = null;
  private promptText: Phaser.GameObjects.Text | null = null;
  /** Boards you can walk up to and draw on. */
  private boardZones: Array<{ x: number; y: number }> = [];
  private boardPrompt: Phaser.GameObjects.Text | null = null;
  private whiteboardOpen = false;
  private eKey!: Phaser.Input.Keyboard.Key;
  private gamepad!: GamepadInput;
  private remotePlayers!: RemotePlayerManager;
  private cleanupPresence: (() => void) | null = null;
  private terminalOpen = false;

  /** sessionKey -> seatId: when a character executes a task, that session binds to the character */
  private sessionBindings = new Map<string, string>();

  private cameraController!: CameraController;
  private workerManager!: WorkerManager;
  private interactionManager!: InteractionManager;
  private doorManager!: DoorManager;
  private cleanupEventBridge: (() => void) | null = null;

  constructor() {
    super({ key: "OfficeScene" });
  }

  preload() {
    this.load.tilemapTiledJSON("office", "/maps/office2.json");

    this.load.once("filecomplete-tilemapJSON-office", () => {
      const cached = this.cache.tilemap.get("office");
      if (!cached?.data?.tilesets) return;
      for (const ts of cached.data.tilesets) {
        const basename = (ts.image as string).split("/").pop()!;
        this.load.image(ts.name, `/tilesets/${basename}`);
      }
    });

    this.load.image(SPRITE_KEY, SPRITE_PATH);

    for (const ws of WORKER_SPRITES) {
      this.load.image(ws.key, ws.path);
    }

    this.load.spritesheet(EMOTE_SHEET_KEY, EMOTE_SHEET_PATH, {
      frameWidth: EMOTE_FRAME_SIZE,
      frameHeight: EMOTE_FRAME_SIZE,
    });

    this.load.spritesheet("boss-arrow", "/sprites/arrow_down_48x48.png", {
      frameWidth: 48,
      frameHeight: 48,
    });

    this.load.spritesheet("anim-cauldron", "/sprites/animated_witch_cauldron_48x48.png", {
      frameWidth: 96,
      frameHeight: 96,
    });

    this.load.spritesheet("anim-door", "/sprites/animated_door_big_4_48x48.png", {
      frameWidth: 48,
      frameHeight: 144,
    });
  }

  create() {
    buildSpriteFrames(this, SPRITE_KEY);
    for (const ws of WORKER_SPRITES) {
      buildSpriteFrames(this, ws.key);
    }

    const map = this.make.tilemap({ key: "office" });

    const allTilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const ts of map.tilesets) {
      const added = map.addTilesetImage(ts.name, ts.name);
      if (added) allTilesets.push(added);
    }
    if (allTilesets.length === 0) {
      log.error("No tilesets loaded");
      return;
    }

    map.createLayer("floor", allTilesets);
    map.createLayer("walls", allTilesets);
    map.createLayer("ground", allTilesets);
    map.createLayer("furniture", allTilesets);
    map.createLayer("objects", allTilesets);

    const animatedProps: AnimatedProp[] = [
      {
        tilesetName: "11_Halloween_48x48",
        anchorLocalId: 130,
        skipLocalIds: new Set([130, 131, 146, 147]),
        spriteKey: "anim-cauldron",
        frameWidth: 96,
        frameHeight: 96,
        endFrame: 11,
        frameRate: 8,
      },
    ];
    renderTileObjectLayer(this, map, "props", allTilesets, 5, animatedProps);
    renderTileObjectLayer(this, map, "props-over", allTilesets, 11);

    const overheadLayer = map.createLayer("overhead", allTilesets);
    if (overheadLayer) overheadLayer.setDepth(10);

    const collisionGroup = this.physics.add.staticGroup();
    const collisionRects = buildCollisionRects(map, collisionGroup);

    const pathfinder = new Pathfinder(
      map.widthInPixels,
      map.heightInPixels,
      collisionRects,
      PF_PADDING,
    );

    const { bossSpawn, workerSpawns } = parseSpawns(map);
    const pois = parsePOIs(map);

    // Any board in the office opens the same shared canvas
    this.boardZones = pois
      .filter((poi) => /white ?board|black ?board|chalk ?board/i.test(poi.name))
      .map((poi) => ({ x: poi.x, y: poi.y }));

    this.player = new Player(this, bossSpawn.x, bossSpawn.y, bossSpawn.facing);
    this.physics.add.collider(this.player.sprite, collisionGroup);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.player.sprite.setCollideWorldBounds(true);

    this.input.keyboard?.disableGlobalCapture();

    // ── Systems ───────────────────────────────────────────
    this.cameraController = new CameraController(
      this,
      this.player.sprite,
      map.widthInPixels,
      map.heightInPixels,
    );
    this.cameraController.init();

    this.workerManager = new WorkerManager(this, workerSpawns, pois, pathfinder);

    this.interactionManager = new InteractionManager(
      this,
      this.player,
      this.workerManager,
      this.cameraController,
    );
    this.interactionManager.initInteractionUI();

    this.doorManager = new DoorManager(this, this.player, () => this.workerManager.workers);
    this.doorManager.initDoors();

    resetWanderClock();
    this.gamepad = new GamepadInput(this);
    this.remotePlayers = new RemotePlayerManager(this);

    // Surface the controller in the HUD: without it, "is it even detected?"
    // is unanswerable from inside the game
    this.gamepad.onConnected = (id, layout) => {
      gameEvents.emit("gamepad-state", id, layout);
    };

    const unsubPresence = gameEvents.on("presence-updated", (players) => {
      this.remotePlayers.sync(players);
    });
    const unsubLeft = gameEvents.on("presence-left", (id) => {
      this.remotePlayers.remove(id);
    });
    const unsubSaid = gameEvents.on("player-said", (playerId, text) => {
      this.remotePlayers.say(playerId, text);
    });
    const unsubSelfSaid = gameEvents.on("self-said", (text) => {
      this.player?.say(text);
    });
    const unsubBoardClosed = gameEvents.on("whiteboard-closed", () => {
      this.whiteboardOpen = false;
    });
    const unsubBadge = gameEvents.on("achievement-earned", (achievement) => {
      // Agents celebrate at their desk; people celebrate wherever they stand
      if (achievement.subjectType === "agent") {
        const worker = this.workerManager.findBySeatId(achievement.subjectId);
        worker?.showBubble(`${achievement.icon} ${achievement.title}`, 5000);
        return;
      }
      this.remotePlayers.say(achievement.subjectId, `${achievement.icon} ${achievement.title}`);
    });
    this.cleanupPresence = () => {
      unsubPresence();
      unsubLeft();
      unsubSaid();
      unsubSelfSaid();
      unsubBadge();
      unsubBoardClosed();
    };
    this.initBossSeat(bossSpawn);

    this.cleanupEventBridge = initSceneEventBridge(
      this.workerManager,
      this.interactionManager,
      this.sessionBindings,
      (open) => {
        this.terminalOpen = open;
      },
    );

    gameEvents.emit("seats-discovered", workerSpawns);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
  }

  // ── Boss seat ──────────────────────────────────────────

  private initBossSeat(bossSpawn: { x: number; y: number }) {
    this.terminalZone = { x: bossSpawn.x, y: bossSpawn.y };

    this.promptText = this.add
      .text(
        bossSpawn.x + BOSS_PROMPT_OFFSET_X,
        bossSpawn.y - BOSS_PROMPT_OFFSET_Y,
        "Press E",
        PRESS_E_STYLE as Phaser.Types.GameObjects.Text.TextStyle,
      )
      .setResolution(window.devicePixelRatio * 2)
      .setOrigin(0, 0)
      .setDepth(20)
      .setVisible(false);
    this.promptText.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);

    this.boardPrompt = this.add
      .text(0, 0, "Press E to draw", PRESS_E_STYLE as Phaser.Types.GameObjects.Text.TextStyle)
      .setResolution(window.devicePixelRatio * 2)
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setVisible(false);
    this.boardPrompt.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);

    const kb = this.input.keyboard;
    if (!kb) return;
    this.eKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E, false);
  }

  // ── Cleanup ────────────────────────────────────────────

  private cleanup() {
    this.cleanupEventBridge?.();
    this.cleanupEventBridge = null;

    this.cleanupPresence?.();
    this.cleanupPresence = null;
    this.remotePlayers?.destroyAll();

    this.workerManager?.destroyAll();
    this.interactionManager?.destroy();
  }

  // ── Update ─────────────────────────────────────────────

  update(_time: number, delta: number) {
    this.gamepad.poll();

    // Remote characters keep easing toward their last reported position even
    // while this player is in a menu or typing.
    this.remotePlayers.update(delta);

    if (this.interactionManager.interactionMenu.visible) {
      this.interactionManager.interactionMenu.update(this.gamepad);
      this.workerManager.updateAll();
      return;
    }

    // Shoulder buttons cycle HUD panels, Back closes the open one. The HUD is
    // React, so this travels over the event bus rather than through the scene.
    if (this.gamepad.justPressed("panelPrev")) gameEvents.emit("hud-cycle-panel", -1);
    if (this.gamepad.justPressed("panelNext")) gameEvents.emit("hud-cycle-panel", 1);
    if (this.gamepad.justPressed("panelClose")) gameEvents.emit("hud-close-panel");

    // B is Escape. Every prompt in the game already closes on Escape, so
    // rather than teaching each one about controllers, the button becomes the
    // key — which also covers any dialog added later.
    if (this.gamepad.justPressed("cancel")) {
      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      });
      // One dispatch is enough: it bubbles document → window, so listeners on
      // either receive it exactly once
      document.dispatchEvent(escape);
    }

    if (this.terminalOpen || this.whiteboardOpen || isInputFocused()) {
      this.workerManager.updateAll();
      this.doorManager.updateDoors();
      return;
    }

    this.player.update(this.gamepad.velocity(MOVE_SPEED));

    gameEvents.emit("player-moved", {
      x: this.player.sprite.x,
      y: this.player.sprite.y,
      facing: this.player.direction,
      moving: this.player.isMoving(),
    });
    if (!this.cameraController.cameraFollowing && this.player.isMoving()) {
      this.cameraController.resumeCameraFollow();
    }
    this.workerManager.updateAll();
    this.doorManager.updateDoors();

    // Worker proximity: E on the keyboard, or confirm on the pad
    const interactPressed =
      Phaser.Input.Keyboard.JustDown(this.eKey) || this.gamepad.justPressed("interact");

    if (this.interactionManager.updateProximity(interactPressed)) {
      return;
    }

    // Whiteboards: walk up, press E, draw
    const nearestBoard = this.boardZones
      .map((zone) => ({
        zone,
        distance: Phaser.Math.Distance.Between(
          this.player.sprite.x,
          this.player.sprite.y,
          zone.x,
          zone.y,
        ),
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    const atBoard = !!nearestBoard && nearestBoard.distance < BOSS_INTERACT_DISTANCE;
    if (this.boardPrompt) {
      this.boardPrompt.setVisible(atBoard && !this.whiteboardOpen);
      if (atBoard) {
        this.boardPrompt.setPosition(nearestBoard.zone.x, nearestBoard.zone.y - 8);
      }
    }

    if (atBoard && interactPressed) {
      this.whiteboardOpen = true;
      this.boardPrompt?.setVisible(false);
      gameEvents.emit("open-whiteboard");
      return;
    }

    // Boss terminal interaction (only when no worker is nearby)
    if (!this.interactionManager.nearestWorker && this.terminalZone && this.promptText) {
      const dist = Phaser.Math.Distance.Between(
        this.player.sprite.x,
        this.player.sprite.y,
        this.terminalZone.x,
        this.terminalZone.y,
      );
      const near = dist < BOSS_INTERACT_DISTANCE;
      this.promptText.setVisible(near);

      if (near && interactPressed) {
        this.terminalOpen = true;
        this.promptText.setVisible(false);
        gameEvents.emit("open-terminal");
      }
    } else if (this.promptText) {
      this.promptText.setVisible(false);
    }
  }
}
