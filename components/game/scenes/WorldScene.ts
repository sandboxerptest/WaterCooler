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
import { DoorLatch, type DoorZone } from "@/lib/doors";
import { ArrivalWalk } from "@/lib/arrival";
import { LOBBY, floorUrl } from "@/lib/world/floors";
import { rememberedCharacter } from "@/lib/characters/choice";
import { OUTSIDE_SPOT, type Whereabouts } from "@/lib/world/residents";
import { createLogger } from "@/lib/logger";
import { gameEvents } from "@/lib/events";
import { frameZoom } from "@/lib/camera";
import { WORLD_PATH, showAddress } from "@/lib/world/paths";
import {
  BUILDINGS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  buildingFrom,
  spawnFor,
  type Building,
} from "@/lib/world/tenants";
import { SCENERY, WORLD_SIGNS, groundTiles, worldSolids } from "@/lib/world/scenery";
import {
  BOAT_KEY,
  addSolid,
  cutOutdoorFrames,
  layGround,
  placeProp,
  placeSign,
  preloadOutdoors,
} from "./outdoors";

const log = createLogger("World");

/** Where each building's name goes: the blank sign the picture leaves, from the frame's top. */
const SIGN_Y: Record<string, number> = {
  "world-castle": 175,
  "world-office": 186,
  "world-supply": 92,
  "world-blocks": 169,
  "world-campus": 173,
  "world-lab": 159,
  [BOAT_KEY]: 136,
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
    preloadOutdoors(this);
    this.load.image("world-pond", "/sprites/world/pond_288x192.png");
    this.load.image("van", "/sprites/world/van_96x144.png");
    this.load.image("world-castle", "/sprites/world/building_castle.png");
    this.load.image("world-office", "/sprites/world/building_office.png");
    this.load.image("world-supply", "/sprites/world/building_supply.png");
    this.load.image("world-blocks", "/sprites/world/building_blocks.png");
    this.load.image("world-campus", "/sprites/world/building_campus.png");
    this.load.image("world-lab", "/sprites/world/building_lab.png");
    // Normally already loaded by the office; guarded for a direct arrival.
    if (!this.textures.exists(SPRITE_KEY)) this.load.image(SPRITE_KEY, SPRITE_PATH);
  }

  create(data: WorldSceneData) {
    this.leaving = false;
    this.latch.reset();
    // A walk that was still under way when a door fired must not resume here.
    this.navigator.cancel();
    // Reached in-page from a lobby: say so in the bar, so a reload comes back here.
    showAddress(WORLD_PATH);
    if (!this.anims.exists("idle-down")) buildSpriteFrames(this, SPRITE_KEY);
    cutOutdoorFrames(this);

    const ground = groundTiles();
    layGround(this, ground);
    const walls = this.physics.add.staticGroup();
    this.zones = BUILDINGS.map((b) => this.placeBuilding(b, walls));
    for (const prop of SCENERY) placeProp(this, prop, walls);
    for (const sign of WORLD_SIGNS) placeSign(this, sign, walls);
    // The buildings and props are already walls of their own; the sea is
    // solid too, so nobody walks off the dock.
    const solids = worldSolids();
    for (const water of solids.slice(BUILDINGS.length + SCENERY.length)) addSolid(walls, water);
    this.pathfinder = new Pathfinder(WORLD_WIDTH, WORLD_HEIGHT, solids, PF_PADDING);

    const at = spawnFor(data?.from);
    const left = buildingFrom(data?.from);
    this.player = new Player(this, at.x, at.y, left?.arrive ?? "down");
    // Out of a building's door: a few steps down the path before the keys
    // are yours, so the key held through the door does not walk you back in.
    // Off the ferry: up the dock, away from the gangway.
    this.arrival.reset();
    if (left) this.arrival.begin(left.arrive ?? "down", 96);
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
    // The rooms' zoom, so people and signs are the size they are indoors;
    // never so far out that the camera would look past the world's edge.
    const zoom = () =>
      Math.max(
        frameZoom(cam.width, cam.height, ZOOM_MIN, ZOOM_MAX),
        cam.width / WORLD_WIDTH,
        cam.height / WORLD_HEIGHT,
      );
    cam.setZoom(zoom());
    this.scale.on("resize", () => cam.setZoom(zoom()));
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
        // Where the server put them; by the fountain when it did not say.
        const spot = resident.spot ?? { x: OUTSIDE_SPOT.x + i * 40, y: OUTSIDE_SPOT.y };
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
    });
  }

  private placeBuilding(b: Building, walls: Phaser.Physics.Arcade.StaticGroup): DoorZone {
    const foot = b.frame.y + b.frame.height;
    this.add.image(b.frame.x, b.frame.y, b.art).setOrigin(0, 0).setDepth(foot);
    addSolid(walls, b.solid);

    // The name, on the sign the picture leaves blank: the same size as a
    // campus building's, so the two maps read alike. The text carries its
    // own strip of the band's colour, so a long name stays readable past
    // the band's ends. The ferry's board is small, and so is its lettering.
    this.add
      .text(b.frame.x + b.frame.width / 2, b.frame.y + SIGN_Y[b.art], b.org.name.toUpperCase(), {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: b.art === BOAT_KEY ? "8px" : "18px",
        color: "#1b1b2a",
        align: "center",
        backgroundColor: "#e0b870",
        padding: { x: 6, y: 3 },
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

  /** The pad's push on the character; nothing while a dialog has the screen. */
  private padVelocity() {
    return dialogOpen() ? { vx: 0, vy: 0 } : this.gamepad.velocity(MOVE_SPEED);
  }

  update(_time: number, delta: number) {
    if (this.leaving) return;
    // Read the pad every frame, or it never reports anything out here.
    this.gamepad.poll();
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
