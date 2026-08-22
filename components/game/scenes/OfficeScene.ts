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
  PLAYER_SPAWN_OFFSET_X,
  BUCKET_INTERACT_DISTANCE,
  CAULDRON_INTERACT_DISTANCE,
  PF_PADDING,
  PRESS_E_STYLE,
  BOSS_PROMPT_OFFSET_X,
  BOSS_PROMPT_OFFSET_Y,
} from "@/lib/constants";

import { CameraController } from "../systems/CameraController";
import { WorkerManager } from "../systems/WorkerManager";
import { InteractionManager } from "../systems/InteractionManager";
import { TapNavigator, isTap } from "../systems/TapNavigator";
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
  private cauldronZone: { x: number; y: number } | null = null;
  private cauldronPrompt: Phaser.GameObjects.Text | null = null;
  private pinballOpen = false;
  private navigator = new TapNavigator();
  private pathfinder: Pathfinder | null = null;
  private walkMarker: Phaser.GameObjects.Arc | null = null;
  /** Set for one frame when something asks for an interaction without a key. */
  private virtualInteract = false;
  private bucketZone: { x: number; y: number } | null = null;
  private bucketPrompt: Phaser.GameObjects.Text | null = null;
  private pingPongOpen = false;
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

    this.pathfinder = pathfinder;

    const { bossSpawn, workerSpawns } = parseSpawns(map);
    const pois = parsePOIs(map);

    // Any board in the office opens the same shared canvas
    this.boardZones = pois
      .filter((poi) => /white ?board|black ?board|chalk ?board/i.test(poi.name))
      .map((poi) => ({ x: poi.x, y: poi.y }));

    // The cauldron in the back room is a pinball table, for reasons the office
    // has never explained
    const cauldron = pois.find((poi) => /cauldron/i.test(poi.name));
    this.cauldronZone = cauldron ? { x: cauldron.x, y: cauldron.y } : null;

    // And the bucket above it is a ping pong table, on the same logic
    const bucket = pois.find((poi) => /bucket/i.test(poi.name));
    this.bucketZone = bucket ? { x: bucket.x, y: bucket.y } : null;

    // Beside the desk, not in it — the nook has walls on three sides
    this.player = new Player(
      this,
      bossSpawn.x + PLAYER_SPAWN_OFFSET_X,
      bossSpawn.y,
      bossSpawn.facing,
    );
    this.physics.add.collider(this.player.sprite, collisionGroup);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.player.sprite.setCollideWorldBounds(true);

    this.input.keyboard?.disableGlobalCapture();
    this.initTapToWalk();

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
    // Listening for the open events rather than only setting the flag where
    // they are emitted means a game opened any other way — the ?pinball=1 and
    // ?board=1 links, say — still stops the character walking about behind it.
    const unsubPinballOpen = gameEvents.on("open-pinball", () => {
      this.pinballOpen = true;
    });

    const unsubInteract = gameEvents.on("interact-pressed", () => {
      this.virtualInteract = true;
    });

    const unsubPongOpen = gameEvents.on("open-pingpong", () => {
      this.pingPongOpen = true;
    });

    const unsubPongClosed = gameEvents.on("pingpong-closed", () => {
      this.pingPongOpen = false;
    });

    const unsubBoardOpen = gameEvents.on("open-whiteboard", () => {
      this.whiteboardOpen = true;
    });

    const unsubPinballClosed = gameEvents.on("pinball-closed", () => {
      this.pinballOpen = false;
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
      unsubBoardOpen();
      unsubBoardClosed();
      unsubPinballOpen();
      unsubPinballClosed();
      unsubPongOpen();
      unsubPongClosed();
      unsubInteract();
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

    this.cauldronPrompt = this.add
      .text(0, 0, "Press E to play", PRESS_E_STYLE as Phaser.Types.GameObjects.Text.TextStyle)
      .setResolution(window.devicePixelRatio * 2)
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setVisible(false);
    this.cauldronPrompt.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);

    this.bucketPrompt = this.add
      .text(0, 0, "Press E for ping pong", PRESS_E_STYLE as Phaser.Types.GameObjects.Text.TextStyle)
      .setResolution(window.devicePixelRatio * 2)
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setVisible(false);
    this.bucketPrompt.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);

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

  /** A tap or the on-screen button standing in for the E key, once. */
  private takeVirtualInteract(): boolean {
    if (!this.virtualInteract) return false;
    this.virtualInteract = false;
    return true;
  }

  // ── Tapping the floor ──────────────────────────────────

  /**
   * Walk to where the player tapped, and do whatever is there when we arrive.
   *
   * A tap has to be told apart from dragging the camera, which uses the same
   * pointer: anything that wandered or was held is a drag. On a phone this is
   * the only way to move at all, and on a desktop it sits happily alongside
   * the keys — either takes over from the other.
   */
  private initTapToWalk() {
    let down: { x: number; y: number; at: number } | null = null;

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      // A press that starts on the worker menu belongs to the menu: it closes
      // itself on release, and without this the same gesture would then read
      // as a tap on the floor underneath it
      down = this.interactionManager.interactionMenu.visible
        ? null
        : { x: pointer.x, y: pointer.y, at: pointer.downTime };

      // Touching the office means you have finished typing. A canvas cannot
      // hold focus of its own, so without this the chat box keeps it — and
      // the scene stands down entirely while a text field is focused, which
      // would leave the character unable to move by any means at all.
      const focused = document.activeElement as HTMLElement | null;
      if (focused && (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT")) {
        focused.blur();
      }
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const start = down;
      down = null;
      if (!start) return;
      if (!isTap(start, { x: pointer.x, y: pointer.y, at: pointer.upTime })) return;

      // Anything with a panel over the office is driving its own input
      if (this.terminalOpen || this.whiteboardOpen || this.pinballOpen || this.pingPongOpen) return;
      if (this.interactionManager.interactionMenu.visible) return;

      const world = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.walkTo(world.x, world.y);
    });

    // The office is somewhere you tap, so a long press must not offer to
    // select the canvas or hand the phone's own menu instead
    this.game.canvas.style.touchAction = "none";
    this.game.canvas.oncontextmenu = (event) => event.preventDefault();
  }

  /**
   * Where the character actually stands.
   *
   * The sprite is a whole person tall and its middle is around their chest;
   * the physics body is a small box at their feet, a good two-thirds of a
   * tile lower. Routes are walked by the body, so they have to be planned
   * and steered from it — measuring from the sprite instead puts the feet
   * below the path, and in a tight spot that means walking into the wall.
   */
  private feet(): { x: number; y: number } {
    const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
    return { x: body.center.x, y: body.center.y };
  }

  /** Route to a point and walk it, acting on whatever is there on arrival. */
  private walkTo(x: number, y: number) {
    if (!this.pathfinder) return;

    const from = this.feet();
    const path = this.pathfinder.findPath(from.x, from.y, x, y);
    if (!path || path.length === 0) return;

    // Whatever is at the end gets the same treatment as pressing E there,
    // so tapping a desk, the cauldron or a board does the obvious thing
    this.navigator.follow(path, () => {
      this.virtualInteract = true;
    });
    this.showWalkMarker(path[path.length - 1]);
    this.cameraController.resumeCameraFollow();
  }

  private showWalkMarker(at: { x: number; y: number }) {
    this.walkMarker?.destroy();
    this.walkMarker = this.add.circle(at.x, at.y, 6, 0xc9a227, 0.9).setDepth(5);
    this.tweens.add({
      targets: this.walkMarker,
      alpha: 0,
      scale: 2,
      duration: 550,
      onComplete: () => {
        this.walkMarker?.destroy();
        this.walkMarker = null;
      },
    });
  }

  /**
   * Send the open dialog somewhere to put its focus ring.
   *
   * Up and left step back, down and right step forward: a dialog's controls
   * are a single loop, whichever way they happen to be laid out, so both axes
   * mean the same thing and neither can strand you. A is the press, and it is
   * reported on release too, for the mic's hold-to-talk.
   */
  private updateDialogNavigation() {
    const pad = this.gamepad;

    const back =
      pad.justPressed("menuUp") ||
      pad.justPressed("menuLeft") ||
      pad.menuDirectionEdge() === -1 ||
      pad.menuDirectionEdgeX() === -1;
    const forward =
      pad.justPressed("menuDown") ||
      pad.justPressed("menuRight") ||
      pad.menuDirectionEdge() === 1 ||
      pad.menuDirectionEdgeX() === 1;

    if (back) gameEvents.emit("hud-focus-move", -1);
    else if (forward) gameEvents.emit("hud-focus-move", 1);

    if (pad.justPressed("interact")) gameEvents.emit("hud-confirm", "down");
    if (pad.justReleased("interact")) gameEvents.emit("hud-confirm", "up");
  }

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

    if (
      this.terminalOpen ||
      this.whiteboardOpen ||
      this.pinballOpen ||
      this.pingPongOpen ||
      isInputFocused()
    ) {
      // A dialog is up, so the pad drives its buttons instead of the character
      this.updateDialogNavigation();
      this.workerManager.updateAll();
      this.doorManager.updateDoors();
      return;
    }

    // A key or a stick means the player has taken over, and the tap they
    // made a moment ago is no longer what they want
    const padVelocity = this.gamepad.velocity(MOVE_SPEED);
    const steering = this.navigator.active ? this.navigator.step(this.feet(), MOVE_SPEED) : null;

    if (
      this.navigator.active &&
      (this.player.hasKeyboardInput() || padVelocity.vx || padVelocity.vy)
    ) {
      this.navigator.cancel();
      this.walkMarker?.destroy();
      this.walkMarker = null;
    }

    this.player.update(steering ?? padVelocity);

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
      Phaser.Input.Keyboard.JustDown(this.eKey) ||
      this.gamepad.justPressed("interact") ||
      this.takeVirtualInteract();

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
      this.boardPrompt?.setVisible(false);
      gameEvents.emit("open-whiteboard");
      return;
    }

    // The water bucket: walk up, press E, play ping pong
    if (this.bucketZone) {
      const distance = Phaser.Math.Distance.Between(
        this.player.sprite.x,
        this.player.sprite.y,
        this.bucketZone.x,
        this.bucketZone.y,
      );
      const atBucket = distance < BUCKET_INTERACT_DISTANCE;

      this.bucketPrompt?.setVisible(atBucket && !this.pingPongOpen);
      if (atBucket) this.bucketPrompt?.setPosition(this.bucketZone.x, this.bucketZone.y - 36);

      if (atBucket && interactPressed) {
        this.bucketPrompt?.setVisible(false);
        gameEvents.emit("open-pingpong");
        return;
      }
    }

    // The cauldron: walk up, press E, play pinball
    if (this.cauldronZone) {
      const distance = Phaser.Math.Distance.Between(
        this.player.sprite.x,
        this.player.sprite.y,
        this.cauldronZone.x,
        this.cauldronZone.y,
      );
      const atCauldron = distance < CAULDRON_INTERACT_DISTANCE;

      this.cauldronPrompt?.setVisible(atCauldron && !this.pinballOpen);
      if (atCauldron) {
        this.cauldronPrompt?.setPosition(this.cauldronZone.x, this.cauldronZone.y - 44);
      }

      if (atCauldron && interactPressed) {
        this.cauldronPrompt?.setVisible(false);
        gameEvents.emit("open-pinball");
        return;
      }
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
