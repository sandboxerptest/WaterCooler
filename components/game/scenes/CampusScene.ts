import * as Phaser from "phaser";
import { Player } from "../entities/Player";
import { TapNavigator, isTap } from "../systems/TapNavigator";
import { GamepadInput } from "../systems/GamepadInput";
import { dialogOpen } from "@/lib/gamepad/dialogs";
import { Pathfinder } from "../utils/Pathfinder";
import { ensureAnims, ensureSheet } from "../utils/sheets";
import { buildSpriteFrames } from "../utils/MapHelpers";
import { SPRITE_KEY, SPRITE_PATH, MOVE_SPEED, WORKER_SPRITES } from "../config/animations";
import { PF_PADDING, ZOOM_MAX, ZOOM_MIN } from "@/lib/constants";
import { frameZoom } from "@/lib/camera";
import { DoorLatch, type DoorZone } from "@/lib/doors";
import { ArrivalWalk } from "@/lib/arrival";
import { LOBBY, floorUrl } from "@/lib/world/floors";
import { rememberedCharacter } from "@/lib/characters/choice";
import { createLogger } from "@/lib/logger";
import { gameEvents } from "@/lib/events";
import { campusPath, showAddress } from "@/lib/world/paths";
import { TILE, organisationFor, type Rect } from "@/lib/world/tenants";
import { campusFor, campusSpawnFor, type Campus, type CampusBuilding } from "@/lib/world/campus";
import type { Whereabouts } from "@/lib/world/residents";
import {
  PROPS,
  groundGrid,
  propBody,
  tilesOf,
  type PlacedProp,
  type PropSpec,
} from "@/lib/world/scenery";

const log = createLogger("Campus");

const GROUND = {
  grass: "world-grass",
  paving: "world-paving",
  kerb: "world-kerb",
  asphalt: "world-asphalt",
} as const;
const PROPS_KEY = "world-props";
/** Where each picture's sign band is, from the frame's top. */
const SIGN_Y: Record<string, number> = {
  "site-warehouse": 61,
  "site-store": 59,
  "site-garage": 63,
  "site-office": 109,
  "site-office-sales": 109,
  "site-office-finance": 100,
  "site-office-operations": 104,
};
// The same pictures doubled, for a yard that fills the screen.
for (const [key, y] of Object.entries(SIGN_Y)) SIGN_Y[`${key}-2x`] = y * 2;
/** A door zone target meaning "back out to the world map". */
const EXIT_TARGET = "world";

export interface CampusSceneData {
  campus: string;
  /** The lobby the person just walked out of, if any. */
  from?: string | null;
}

/**
 * A campus: an organisation's yard of little buildings.
 *
 * Every building here is one of the organisation's lobbies, and walking
 * into it is the same as walking into a building on the world map — a new
 * page, with its own people and conversation. The road at the bottom is the
 * way back to the world map. Like the world map, this is a menu and not a
 * place: no presence, nothing to do but choose a door.
 */
export class CampusScene extends Phaser.Scene {
  private player!: Player;
  private gamepad!: GamepadInput;
  private navigator = new TapNavigator();
  private latch = new DoorLatch();
  private zones: DoorZone[] = [];
  private pathfinder: Pathfinder | null = null;
  private campus!: Campus;
  /** Residents currently on the yard, by id. */
  private residents = new Map<string, Phaser.GameObjects.GameObject[]>();
  private leaving = false;
  private arrival = new ArrivalWalk();

  constructor() {
    super({ key: "CampusScene" });
  }

  preload() {
    this.load.image(GROUND.grass, "/sprites/world/grass_48.png");
    this.load.image(GROUND.paving, "/sprites/world/paving_48.png");
    this.load.image(GROUND.kerb, "/sprites/world/kerb_48.png");
    this.load.image(GROUND.asphalt, "/sprites/world/asphalt_48.png");
    this.load.image(PROPS_KEY, "/sprites/world/props.png");
    this.load.json("world-props-frames", "/sprites/world/props.json");
    for (const key of Object.keys(SIGN_Y)) {
      if (key === "site-office-2x") continue;
      this.load.image(key, `/sprites/world/${key.replace(/-/g, "_")}.png`);
    }
    if (!this.textures.exists(SPRITE_KEY)) this.load.image(SPRITE_KEY, SPRITE_PATH);
  }

  create(data: CampusSceneData) {
    const campus = campusFor(data?.campus);
    if (!campus) {
      log.error(`no campus "${data?.campus}"; back to the world`);
      this.scene.start("WorldScene", {});
      return;
    }
    this.campus = campus;
    this.residents.clear();
    this.leaving = false;
    this.latch.reset();
    // A walk that was still under way when a door fired must not resume here.
    this.navigator.cancel();
    // Reached in-page from the world or a lobby: say so in the bar, so a reload comes back here.
    showAddress(campusPath(campus.slug));
    if (!this.anims.exists("idle-down")) buildSpriteFrames(this, SPRITE_KEY);
    this.cutFrames();

    const width = campus.columns * TILE;
    const height = campus.rows * TILE;
    this.layGround(campus);
    const walls = this.physics.add.staticGroup();
    this.zones = campus.buildings.map((b) => this.placeBuilding(b, walls));
    this.zones.push({ name: "road", target: EXIT_TARGET, ...campus.exit, facing: "down" });
    for (const prop of campus.props) this.placeProp(prop, walls);
    this.pathfinder = new Pathfinder(
      width,
      height,
      [
        ...campus.buildings.map((b) => b.solid),
        ...campus.props.map(propBody).filter((r) => r !== null),
      ],
      PF_PADDING,
    );

    const at = campusSpawnFor(campus, data?.from);
    const fromBuilding = campus.buildings.find((b) => b.tenant.slug === data?.from);
    const direction = fromBuilding?.exitDirection ?? "up";
    this.player = new Player(this, at.x, at.y, direction);
    // Out of a building: steps away from its door. In from the road: steps
    // up onto the yard, clear of the road out.
    this.arrival.reset();
    this.arrival.begin(direction, 96);
    this.player.sprite.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, width, height);
    this.physics.add.collider(this.player.sprite, walls);

    const remembered = rememberedCharacter();
    if (remembered && remembered.key !== SPRITE_KEY) {
      ensureSheet(this, remembered.key, remembered.path, (ok) => {
        if (ok) this.player.wearSprite(this, remembered.key);
      });
    }

    // The whole yard on one screen, at the same scale as every room: the
    // lobby's zoom, not a fit of its own, so nothing here looks larger or
    // smaller than it does through a door.
    const cam = this.cameras.main;
    cam.setBackgroundColor("#1a1814");
    cam.setRoundPixels(true);
    cam.setZoom(frameZoom(cam.width, cam.height, ZOOM_MIN, ZOOM_MAX));
    cam.centerOn(width / 2, height / 2);
    this.scale.on("resize", () => {
      cam.setZoom(frameZoom(cam.width, cam.height, ZOOM_MIN, ZOOM_MAX));
      cam.centerOn(width / 2, height / 2);
    });

    // Whose yard this is, across the top.
    const company = organisationFor(campus.slug);
    this.add
      .text(width / 2, 14, (company?.name ?? campus.slug).toUpperCase(), {
        fontFamily: '"ArkPixel", "Press Start 2P", monospace',
        fontSize: "16px",
        color: "#ffe9a8",
        backgroundColor: "rgba(27,27,42,0.85)",
        padding: { x: 10, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setDepth(50)
      .setResolution(2);

    this.gamepad = new GamepadInput(this);
    this.initTapToWalk();
    gameEvents.emit("place-changed", `${company?.name ?? campus.slug} · Campus`);

    // Anyone out on the yard. It has no room, so ask where everyone is.
    void this.showResidents();
    this.time.addEvent({ delay: 10_000, loop: true, callback: () => void this.showResidents() });
    log.info(
      `on the ${organisationFor(campus.slug)?.name ?? campus.slug} campus, from ${data?.from ?? "the road"}`,
    );
  }

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

  private layGround(campus: Campus) {
    const grid = groundGrid(
      campus.columns,
      campus.rows,
      campus.paved,
      campus.buildings.map((b) => tilesOf(b.frame)),
    );
    grid.forEach((row, ty) =>
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
      : this.add.image(prop.x, prop.y, PROPS_KEY, prop.kind);
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

  private placeBuilding(b: CampusBuilding, walls: Phaser.Physics.Arcade.StaticGroup): DoorZone {
    const foot = b.frame.y + b.frame.height;
    this.add.image(b.frame.x, b.frame.y, b.art).setOrigin(0, 0).setDepth(foot);
    this.solid(walls, b.solid);

    // What it is, on the sign band the picture leaves blank. The text
    // carries its own strip of the band's colour, so a long name stays
    // readable past the band's ends.
    this.add
      .text(
        b.frame.x + b.frame.width / 2,
        b.frame.y + (SIGN_Y[b.art] ?? 60),
        (b.tenant.location ?? "").toUpperCase(),
        {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: b.art.endsWith("-2x") ? "18px" : "11px",
          color: "#1b1b2a",
          align: "center",
          backgroundColor: "#e0b870",
          padding: { x: 6, y: 3 },
        },
      )
      .setOrigin(0.5, 0.5)
      .setDepth(foot + 1)
      .setResolution(2);
    return {
      name: b.tenant.slug,
      target: floorUrl(b.tenant, LOBBY, "door"),
      ...b.door,
      facing: b.side === "bottom" ? "up" : b.side,
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
      const path = this.pathfinder?.findPath(from.x, from.y, world.x, world.y);
      this.navigator.follow(path?.length ? path : [{ x: world.x, y: world.y }]);
    });
  }

  /** Draw the residents the server says are on this yard, and take away those who left. */
  private async showResidents() {
    let here: Whereabouts[] = [];
    try {
      const res = await fetch("/api/residents");
      const body = (await res.json()) as { residents?: Whereabouts[] };
      here = (body.residents ?? []).filter(
        (r) => r.place === "campus" && r.campus === this.campus.slug && r.spot,
      );
    } catch {
      return;
    }
    if (!this.scene.isActive()) return;

    for (const [id, parts] of this.residents) {
      if (here.some((r) => r.id === id)) continue;
      for (const part of parts) part.destroy();
      this.residents.delete(id);
    }
    for (const resident of here) {
      if (this.residents.has(resident.id)) continue;
      const path = WORKER_SPRITES.find((w) => w.key === resident.spriteKey)?.path;
      const spot = resident.spot;
      if (!path || !spot) continue;
      this.residents.set(resident.id, []);
      ensureSheet(this, resident.spriteKey, path, (ok) => {
        if (!ok || !this.scene.isActive() || !this.residents.has(resident.id)) return;
        ensureAnims(this, resident.spriteKey);
        const sprite = this.add.sprite(spot.x, spot.y - 43, resident.spriteKey, 0).setDepth(spot.y);
        sprite.play(`${resident.spriteKey}:idle-down`);
        const tag = this.add
          .text(spot.x, spot.y + 6, resident.name, {
            fontFamily: '"Press Start 2P", monospace',
            fontSize: "8px",
            color: "#ffe9a8",
            backgroundColor: "rgba(0,0,0,0.7)",
            padding: { x: 4, y: 2 },
          })
          .setOrigin(0.5, 0)
          .setDepth(spot.y + 1)
          .setResolution(2);
        this.residents.set(resident.id, [sprite, tag]);
      });
    }
  }

  private feet() {
    const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
    return { x: body.center.x, y: body.center.y };
  }

  /** The pad's push on the character; nothing while a dialog has the screen. */
  private padVelocity() {
    return dialogOpen() ? { vx: 0, vy: 0 } : this.gamepad.velocity(MOVE_SPEED);
  }

  update(_time: number, delta: number) {
    if (this.leaving) return;
    if (this.arrival.holdsInput) {
      if (this.arrival.walking) {
        this.player.drive(this.arrival.step(delta, MOVE_SPEED));
      } else {
        const wanted = this.player.inputVelocity(this.padVelocity());
        this.arrival.release(wanted.vx !== 0 || wanted.vy !== 0);
        this.player.drive(this.arrival.allow(wanted));
        for (const zone of this.latch.step(this.zones, this.feet())) this.enter(zone);
      }
      this.player.sprite.setDepth((this.player.sprite.body as Phaser.Physics.Arcade.Body).bottom);
      return;
    }
    const padVelocity = this.padVelocity();
    const steering = this.navigator.active ? this.navigator.step(this.feet(), MOVE_SPEED) : null;
    if (
      this.navigator.active &&
      (this.player.hasKeyboardInput() || padVelocity.vx || padVelocity.vy)
    ) {
      this.navigator.cancel();
    }
    this.player.update(steering ?? padVelocity);
    this.player.sprite.setDepth((this.player.sprite.body as Phaser.Physics.Arcade.Body).bottom);
    for (const zone of this.latch.step(this.zones, this.feet())) this.enter(zone);
  }

  /** Through a door to a lobby's page, or down the road back to the world map. */
  private enter(zone: DoorZone) {
    this.leaving = true;
    this.player.update({ vx: 0, vy: 0 });
    log.info(`entering ${zone.name}`);
    if (zone.target === EXIT_TARGET) {
      this.scene.start("WorldScene", { from: this.campus.slug });
      return;
    }
    window.location.assign(zone.target);
  }
}
