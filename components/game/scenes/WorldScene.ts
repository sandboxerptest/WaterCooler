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
import { gameEvents } from "@/lib/events";
import {
  BUILDINGS,
  TILE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  buildingFrom,
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

const GROUND = {
  grass: "world-grass",
  paving: "world-paving",
  kerb: "world-kerb",
  asphalt: "world-asphalt",
} as const;
const PROPS_KEY = "world-props";
/** Where each building's name goes: the blank sign the picture leaves, from the frame's top. */
const SIGN_Y: Record<string, number> = {
  "world-castle": 175,
  "world-office": 186,
  "world-supply": 92,
  "world-blocks": 169,
  "world-campus": 173,
};
/** A door zone target that starts a scene rather than loading a page. */
const CAMPUS_TARGET = "campus:";

export interface WorldSceneData {
  /** The tenant or campus whose building the person just walked out of, if any. */
  from?: string | null;
}

/**
 * Outside.
 *
 * The world map is the space between businesses: three screens of green
 * with the two head offices and a plaza in the middle, the building supply
 * stores to the west and the campus gate to the east, and a path to each
 * door. Walking into a lobby's door moves you to that tenant's room, which
 * is a new page — every room carries its own people, agents and
 * conversation, so the boundary between businesses is the room boundary.
 * Walking through a campus gate goes onto its yard, another scene here.
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
    this.load.image(GROUND.asphalt, "/sprites/world/asphalt_48.png");
    this.load.image("world-pond", "/sprites/world/pond_288x192.png");
    this.load.image("van", "/sprites/world/van_96x144.png");
    this.load.image("world-castle", "/sprites/world/building_castle.png");
    this.load.image("world-office", "/sprites/world/building_office.png");
    this.load.image("world-supply", "/sprites/world/building_supply.png");
    this.load.image("world-blocks", "/sprites/world/building_blocks.png");
    this.load.image("world-campus", "/sprites/world/building_campus.png");
    this.load.image(PROPS_KEY, "/sprites/world/props.png");
    this.load.json("world-props-frames", "/sprites/world/props.json");
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
    if (buildingFrom(data?.from)) this.arrival.begin("down", 96);
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
    gameEvents.emit("place-changed", "World map");
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

  /** Name the rectangles of the props sheet so they can be drawn by name. */
  private cutFrames() {
    const props = this.textures.get(PROPS_KEY);
    const frames = this.cache.json.get("world-props-frames") as Record<string, Rect> | undefined;
    for (const [name, r] of Object.entries(frames ?? {})) {
      if (!props.has(name)) props.add(name, 0, r.x, r.y, r.width, r.height);
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
    const image = spec.animate
      ? this.add.sprite(prop.x, prop.y, PROPS_KEY, prop.kind).play("world-fountain")
      : spec.texture
        ? this.add.image(prop.x, prop.y, spec.texture)
        : this.add.image(prop.x, prop.y, PROPS_KEY, prop.kind);
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
    const foot = b.frame.y + b.frame.height;
    this.add.image(b.frame.x, b.frame.y, b.art).setOrigin(0, 0).setDepth(foot);
    this.solid(walls, b.solid);

    // The name, on the sign the picture leaves blank — large, on its own
    // strip of the sign's colour, so it reads from across the green.
    this.add
      .text(b.frame.x + b.frame.width / 2, b.frame.y + SIGN_Y[b.art], b.org.name.toUpperCase(), {
        fontFamily: '"ArkPixel", "Press Start 2P", monospace',
        fontSize: "14px",
        color: "#1b1b2a",
        align: "center",
        backgroundColor: "#e0b870",
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5, 0.5)
      .setDepth(foot + 1)
      .setResolution(2);

    const target =
      b.entrance.kind === "lobby"
        ? floorUrl(b.entrance.tenant, LOBBY, "door")
        : `${CAMPUS_TARGET}${b.entrance.campus}`;
    return { name: b.org.slug, target, ...b.door, facing: "up" };
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
        for (const zone of this.latch.step(this.zones, this.feet())) this.enter(zone);
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

    for (const zone of this.latch.step(this.zones, this.feet())) this.enter(zone);
  }

  /** Through a door: onto a campus here, or off to a lobby's page. */
  private enter(zone: DoorZone) {
    this.leaving = true;
    this.player.update({ vx: 0, vy: 0 });
    log.info(`entering ${zone.name}`);
    if (zone.target.startsWith(CAMPUS_TARGET)) {
      this.scene.start("CampusScene", { campus: zone.target.slice(CAMPUS_TARGET.length) });
      return;
    }
    window.location.assign(zone.target);
  }
}
