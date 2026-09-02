import * as Phaser from "phaser";
import { Player } from "../entities/Player";
import { TapNavigator, isTap } from "../systems/TapNavigator";
import { GamepadInput } from "../systems/GamepadInput";
import { Pathfinder } from "../utils/Pathfinder";
import { ensureAnims, ensureSheet } from "../utils/sheets";
import { buildSpriteFrames } from "../utils/MapHelpers";
import { SPRITE_KEY, SPRITE_PATH, MOVE_SPEED, WORKER_SPRITES } from "../config/animations";
import { PF_PADDING } from "@/lib/constants";
import { DoorLatch, type DoorZone } from "@/lib/doors";
import { ArrivalWalk } from "@/lib/arrival";
import { LOBBY, floorUrl } from "@/lib/world/floors";
import { rememberedCharacter } from "@/lib/characters/choice";
import { OUTSIDE_SPOT, type Whereabouts } from "@/lib/world/residents";
import { createLogger } from "@/lib/logger";
import {
  BUILDINGS,
  TILE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  spawnFor,
  type Building,
  type Rect,
} from "@/lib/world/tenants";
import {
  PROPS,
  SCENERY,
  groundTiles,
  propBody,
  type PlacedProp,
  type PropSpec,
} from "@/lib/world/scenery";

const log = createLogger("World");

const GROUND = { grass: "world-grass", paving: "world-paving", kerb: "world-kerb" } as const;
const PROPS_KEY = "world-props";
const CAFE_KEY = "world-cafe";
/** Where each building's name goes: the blank sign the picture leaves, from the frame's top. */
const SIGN_Y = { castle: 175, office: 186 } as const;

export interface WorldSceneData {
  /** The tenant whose building the person just walked out of, if any. */
  from?: string | null;
}

/**
 * Outside.
 *
 * The world map is the space between businesses: two buildings on a green
 * with a plaza between them, and a path to each door. Walking into a door
 * moves you to that tenant's room, which is a new page — every room carries
 * its own people, agents and conversation, so the boundary between
 * businesses is the room boundary.
 *
 * Deliberately a lobby and not a place: no presence, no chat, nothing to do
 * but choose a door.
 */
export class WorldScene extends Phaser.Scene {
  private player!: Player;
  private gamepad!: GamepadInput;
  private navigator = new TapNavigator();
  private latch = new DoorLatch();
  private zones: DoorZone[] = [];
  private pathfinder: Pathfinder | null = null;
  private leaving = false;
  /** The steps taken on coming out of a door, before the keys are the player's. */
  private arrival = new ArrivalWalk();
  /** Residents currently out on the green, by id. */
  private residents = new Map<string, Phaser.GameObjects.GameObject[]>();

  constructor() {
    super({ key: "WorldScene" });
  }

  preload() {
    this.load.image(GROUND.grass, "/sprites/world/grass_48.png");
    this.load.image(GROUND.paving, "/sprites/world/paving_48.png");
    this.load.image(GROUND.kerb, "/sprites/world/kerb_48.png");
    this.load.image("world-castle", "/sprites/world/building_castle.png");
    this.load.image("world-office", "/sprites/world/building_office.png");
    this.load.image(PROPS_KEY, "/sprites/world/props.png");
    this.load.json("world-props-frames", "/sprites/world/props.json");
    // The café furniture is the interiors' own, so it matches the rooms.
    this.load.image(CAFE_KEY, "/tilesets/9_Fishing_48x48.png");
    // Normally already loaded by the office; guarded for a direct arrival.
    if (!this.textures.exists(SPRITE_KEY)) this.load.image(SPRITE_KEY, SPRITE_PATH);
  }

  create(data: WorldSceneData) {
    this.leaving = false;
    this.latch.reset();
    if (!this.anims.exists("idle-down")) buildSpriteFrames(this, SPRITE_KEY);
    this.cutFrames();

    this.layGround();
    const walls = this.physics.add.staticGroup();
    this.zones = BUILDINGS.map((b) => this.placeBuilding(b, walls));
    for (const prop of SCENERY) this.placeProp(prop, walls);
    this.pathfinder = new Pathfinder(
      WORLD_WIDTH,
      WORLD_HEIGHT,
      [...BUILDINGS.map((b) => b.solid), ...SCENERY.map(propBody).filter((r) => r !== null)],
      PF_PADDING,
    );

    const at = spawnFor(data?.from);
    this.player = new Player(this, at.x, at.y, "down");
    // Out of a building's door: a few steps down the path before the keys
    // are yours, so the key held through the door does not walk you back in.
    this.arrival.reset();
    if (BUILDINGS.some((b) => b.tenant.slug === data?.from)) this.arrival.begin("down", 96);
    this.player.sprite.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.physics.add.collider(this.player.sprite, walls);

    // Look like yourself out here too.
    const remembered = rememberedCharacter();
    if (remembered && remembered.key !== SPRITE_KEY) {
      ensureSheet(this, remembered.key, remembered.path, (ok) => {
        if (ok) this.player.wearSprite(this, remembered.key);
      });
    }

    const cam = this.cameras.main;
    cam.setBackgroundColor("#1a1814");
    cam.setRoundPixels(true);
    cam.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    cam.setZoom(Math.max(cam.width / WORLD_WIDTH, cam.height / WORLD_HEIGHT, 0.8));
    cam.startFollow(this.player.sprite, true, 0.12, 0.12);

    this.gamepad = new GamepadInput(this);
    this.initTapToWalk();
    log.info(`outside, arriving from ${data?.from ?? "the road"}`);

    // Anyone taking the air. Outside has no room, so ask where everyone is.
    void this.showResidents();
    this.time.addEvent({ delay: 10_000, loop: true, callback: () => void this.showResidents() });
  }

  private async showResidents() {
    let outside: Whereabouts[] = [];
    try {
      const res = await fetch("/api/residents");
      const body = (await res.json()) as { residents?: Whereabouts[] };
      outside = (body.residents ?? []).filter((r) => r.place === "outside");
    } catch {
      return;
    }
    if (!this.scene.isActive()) return;

    for (const [id, parts] of this.residents) {
      if (outside.some((r) => r.id === id)) continue;
      for (const part of parts) part.destroy();
      this.residents.delete(id);
    }
    outside.forEach((resident, i) => {
      if (this.residents.has(resident.id)) return;
      const path = WORKER_SPRITES.find((w) => w.key === resident.spriteKey)?.path;
      if (!path) return;
      this.residents.set(resident.id, []);
      ensureSheet(this, resident.spriteKey, path, (ok) => {
        if (!ok || !this.scene.isActive() || !this.residents.has(resident.id)) return;
        ensureAnims(this, resident.spriteKey);
        const feetX = OUTSIDE_SPOT.x + i * 40;
        const sprite = this.add
          .sprite(feetX, OUTSIDE_SPOT.y - 43, resident.spriteKey, 0)
          .setDepth(OUTSIDE_SPOT.y);
        sprite.play(`${resident.spriteKey}:idle-down`);
        const tag = this.add
          .text(feetX, OUTSIDE_SPOT.y + 6, resident.name, {
            fontFamily: '"Press Start 2P", monospace',
            fontSize: "8px",
            color: "#ffe9a8",
            backgroundColor: "rgba(0,0,0,0.7)",
            padding: { x: 4, y: 2 },
          })
          .setOrigin(0.5, 0)
          .setDepth(OUTSIDE_SPOT.y + 1)
          .setResolution(2);
        this.residents.set(resident.id, [sprite, tag]);
      });
    });
  }

  /** Name the rectangles of the props sheet and the tileset so they can be drawn by name. */
  private cutFrames() {
    const props = this.textures.get(PROPS_KEY);
    const frames = this.cache.json.get("world-props-frames") as Record<string, Rect> | undefined;
    for (const [name, r] of Object.entries(frames ?? {})) {
      if (!props.has(name)) props.add(name, 0, r.x, r.y, r.width, r.height);
    }
    const cafe = this.textures.get(CAFE_KEY);
    for (const [name, spec] of Object.entries(PROPS) as [string, PropSpec][]) {
      if (spec.source !== "cafe" || !spec.crop || cafe.has(name)) continue;
      cafe.add(name, 0, spec.crop.x, spec.crop.y, spec.crop.width, spec.crop.height);
    }
    if (!this.anims.exists("world-fountain")) {
      this.anims.create({
        key: "world-fountain",
        frames: [
          { key: PROPS_KEY, frame: "fountain" },
          { key: PROPS_KEY, frame: "fountain2" },
        ],
        frameRate: 3,
        repeat: -1,
      });
    }
  }

  private layGround() {
    const tiles = groundTiles();
    tiles.forEach((row, ty) =>
      row.forEach((ground, tx) => {
        this.add
          .image(tx * TILE, ty * TILE, GROUND[ground])
          .setOrigin(0, 0)
          .setDepth(0);
      }),
    );
  }

  private placeProp(prop: PlacedProp, walls: Phaser.Physics.Arcade.StaticGroup) {
    const spec: PropSpec = PROPS[prop.kind];
    const key = spec.source === "cafe" ? CAFE_KEY : PROPS_KEY;
    const image = spec.animate
      ? this.add.sprite(prop.x, prop.y, key, prop.kind).play("world-fountain")
      : this.add.image(prop.x, prop.y, key, prop.kind);
    // Feet on the ground; whoever's feet are lower stands in front.
    image.setOrigin(0.5, 1).setDepth(prop.y);
    const body = propBody(prop);
    if (body) this.solid(walls, body);
  }

  private solid(walls: Phaser.Physics.Arcade.StaticGroup, r: Rect) {
    const wall = walls.create(
      r.x + r.width / 2,
      r.y + r.height / 2,
      undefined,
      undefined,
      false,
    ) as Phaser.Physics.Arcade.Sprite;
    wall.body!.setSize(r.width, r.height);
    wall.setVisible(false);
    (wall.body as Phaser.Physics.Arcade.StaticBody).enable = true;
  }

  private placeBuilding(b: Building, walls: Phaser.Physics.Arcade.StaticGroup): DoorZone {
    const key = b.tenant.style === "castle" ? "world-castle" : "world-office";
    const foot = b.frame.y + b.frame.height;
    this.add.image(b.frame.x, b.frame.y, key).setOrigin(0, 0).setDepth(foot);
    this.solid(walls, b.solid);

    // The name, on the sign the picture leaves blank.
    this.add
      .text(b.frame.x + b.frame.width / 2, b.frame.y + SIGN_Y[b.tenant.style], b.tenant.name, {
        fontFamily: '"ArkPixel", "Press Start 2P", monospace',
        fontSize: "11px",
        color: "#1b1b2a",
        align: "center",
      })
      .setOrigin(0.5, 0.5)
      .setDepth(foot + 1)
      .setResolution(2);
    this.add
      .text(b.frame.x + b.frame.width / 2, b.frame.y - 10, b.tenant.tagline, {
        fontFamily: '"ArkPixel", "Press Start 2P", monospace',
        fontSize: "9px",
        color: "#e8e4d8",
        stroke: "#1b1b2a",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(foot + 1)
      .setResolution(2);

    return {
      name: b.tenant.slug,
      target: floorUrl(b.tenant, LOBBY, "door"),
      ...b.door,
      facing: "up",
    };
  }

  private initTapToWalk() {
    let down: { x: number; y: number; at: number } | null = null;
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      down = { x: p.x, y: p.y, at: p.downTime };
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      const start = down;
      down = null;
      if (!start || !isTap(start, { x: p.x, y: p.y, at: p.upTime })) return;
      const world = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const from = this.feet();
      // Around the furniture if we can; straight at it if the spot is boxed in.
      const path = this.pathfinder?.findPath(from.x, from.y, world.x, world.y);
      this.navigator.follow(path?.length ? path : [{ x: world.x, y: world.y }]);
    });
  }

  private feet() {
    const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
    return { x: body.center.x, y: body.center.y };
  }

  update(_time: number, delta: number) {
    if (this.leaving) return;
    if (this.arrival.holdsInput) {
      if (this.arrival.walking) {
        this.player.drive(this.arrival.step(delta, MOVE_SPEED));
      } else {
        const wanted = this.player.inputVelocity(this.gamepad.velocity(MOVE_SPEED));
        this.arrival.release(wanted.vx !== 0 || wanted.vy !== 0);
        this.player.drive(this.arrival.allow(wanted));
        for (const zone of this.latch.step(this.zones, this.feet())) {
          this.leaving = true;
          this.player.update({ vx: 0, vy: 0 });
          log.info(`entering ${zone.name}`);
          window.location.assign(zone.target);
        }
      }
      this.player.sprite.setDepth((this.player.sprite.body as Phaser.Physics.Arcade.Body).bottom);
      return;
    }
    const padVelocity = this.gamepad.velocity(MOVE_SPEED);
    const steering = this.navigator.active ? this.navigator.step(this.feet(), MOVE_SPEED) : null;
    if (
      this.navigator.active &&
      (this.player.hasKeyboardInput() || padVelocity.vx || padVelocity.vy)
    ) {
      this.navigator.cancel();
    }
    this.player.update(steering ?? padVelocity);
    // Sort against the props by where the feet are.
    this.player.sprite.setDepth((this.player.sprite.body as Phaser.Physics.Arcade.Body).bottom);

    for (const zone of this.latch.step(this.zones, this.feet())) {
      this.leaving = true;
      this.player.update({ vx: 0, vy: 0 });
      log.info(`entering ${zone.name}`);
      window.location.assign(zone.target);
    }
  }
}
