import * as Phaser from "phaser";
import { TILE, BOAT, type Rect } from "@/lib/world/tenants";
import {
  PROPS,
  propBody,
  signBody,
  type Ground,
  type PlacedProp,
  type PropSpec,
  type Sign,
} from "@/lib/world/scenery";

/**
 * What the world map and the campuses draw alike: the ground, the water
 * and its foam, the props, the signs and the ferry. Both scenes lay their
 * pictures from the same sheet, so the pieces live here once.
 */

export const PROPS_KEY = "world-props";
export const BOAT_KEY = "world-boat";
const WATER_KEY = "world-water";
const WATER2_KEY = "world-water2";
const FOAM_KEY = "world-foam";
const WATER_ANIM = "world-water";
const FOUNTAIN_ANIM = "world-fountain";

const GROUND: Record<Exclude<Ground, "water">, string> = {
  grass: "world-grass",
  paving: "world-paving",
  kerb: "world-kerb",
  asphalt: "world-asphalt",
  dock: "world-dock",
};

export function preloadOutdoors(scene: Phaser.Scene) {
  scene.load.image(GROUND.grass, "/sprites/world/grass_48.png");
  scene.load.image(GROUND.paving, "/sprites/world/paving_48.png");
  scene.load.image(GROUND.kerb, "/sprites/world/kerb_48.png");
  scene.load.image(GROUND.asphalt, "/sprites/world/asphalt_48.png");
  scene.load.image(GROUND.dock, "/sprites/world/dock_48.png");
  scene.load.image(WATER_KEY, "/sprites/world/water_48.png");
  scene.load.image(WATER2_KEY, "/sprites/world/water2_48.png");
  scene.load.image(FOAM_KEY, "/sprites/world/foam_48.png");
  scene.load.image(BOAT_KEY, "/sprites/world/boat_192x168.png");
  scene.load.image(PROPS_KEY, "/sprites/world/props.png");
  scene.load.json("world-props-frames", "/sprites/world/props.json");
}

/** Name the rectangles of the props sheet, and set up what moves: the fountain and the sea. */
export function cutOutdoorFrames(scene: Phaser.Scene) {
  const props = scene.textures.get(PROPS_KEY);
  const frames = scene.cache.json.get("world-props-frames") as Record<string, Rect> | undefined;
  for (const [name, r] of Object.entries(frames ?? {})) {
    if (!props.has(name)) props.add(name, 0, r.x, r.y, r.width, r.height);
  }
  if (!scene.anims.exists(FOUNTAIN_ANIM)) {
    scene.anims.create({
      key: FOUNTAIN_ANIM,
      frames: [
        { key: PROPS_KEY, frame: "fountain" },
        { key: PROPS_KEY, frame: "fountain2" },
      ],
      frameRate: 3,
      repeat: -1,
    });
  }
  if (!scene.anims.exists(WATER_ANIM)) {
    scene.anims.create({
      key: WATER_ANIM,
      frames: [{ key: WATER_KEY }, { key: WATER2_KEY }],
      frameRate: 1.5,
      repeat: -1,
    });
  }
}

/**
 * Lay the ground tile by tile. Water moves, and gets a line of foam along
 * any edge that meets land; the dock lies over it and is walked like paving.
 */
export function layGround(scene: Phaser.Scene, grid: Ground[][]) {
  const isWater = (tx: number, ty: number) => grid[ty]?.[tx] === "water";
  grid.forEach((row, ty) =>
    row.forEach((ground, tx) => {
      const x = tx * TILE;
      const y = ty * TILE;
      if (ground !== "water") {
        scene.add.image(x, y, GROUND[ground]).setOrigin(0, 0).setDepth(0);
        return;
      }
      scene.add.sprite(x, y, WATER_KEY).setOrigin(0, 0).setDepth(0).play(WATER_ANIM);
      // Foam where the water laps at the land — but not at the map's edge,
      // where the sea just carries on.
      const edges: [number, number, number][] = [
        [tx, ty - 1, 0],
        [tx + 1, ty, 90],
        [tx, ty + 1, 180],
        [tx - 1, ty, 270],
      ];
      for (const [nx, ny, angle] of edges) {
        if (grid[ny]?.[nx] === undefined || isWater(nx, ny)) continue;
        scene.add
          .image(x + TILE / 2, y + TILE / 2, FOAM_KEY)
          .setAngle(angle)
          .setDepth(1);
      }
    }),
  );
}

/** An invisible wall the size of a rectangle. */
export function addSolid(walls: Phaser.Physics.Arcade.StaticGroup, r: Rect) {
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

/** A prop on its feet; whoever's feet are lower stands in front. */
export function placeProp(
  scene: Phaser.Scene,
  prop: PlacedProp,
  walls: Phaser.Physics.Arcade.StaticGroup,
) {
  const spec: PropSpec = PROPS[prop.kind];
  const image = spec.animate
    ? scene.add.sprite(prop.x, prop.y, PROPS_KEY, prop.kind).play(FOUNTAIN_ANIM)
    : spec.texture
      ? scene.add.image(prop.x, prop.y, spec.texture)
      : scene.add.image(prop.x, prop.y, PROPS_KEY, prop.kind);
  image.setOrigin(0.5, 1).setDepth(prop.y);
  const body = propBody(prop);
  if (body) addSolid(walls, body);
}

/** A board on two posts with its words painted on, standing on its feet. */
export function placeSign(
  scene: Phaser.Scene,
  sign: Sign,
  walls: Phaser.Physics.Arcade.StaticGroup,
) {
  scene.add.image(sign.x, sign.y, PROPS_KEY, "board").setOrigin(0.5, 1).setDepth(sign.y);
  scene.add
    .text(sign.x, sign.y - 58, sign.text, {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: "11px",
      color: "#1b1b2a",
      align: "center",
      lineSpacing: 4,
    })
    .setOrigin(0.5, 0.5)
    .setDepth(sign.y + 1)
    .setResolution(2);
  addSolid(walls, signBody(sign));
}

/** The ferry, moored with its bow up, its name on the board along the near side. */
export function placeBoat(
  scene: Phaser.Scene,
  at: { x: number; y: number },
  walls: Phaser.Physics.Arcade.StaticGroup,
  name: string,
) {
  const foot = at.y + BOAT.height;
  scene.add.image(at.x, at.y, BOAT_KEY).setOrigin(0, 0).setDepth(foot);
  scene.add
    .text(at.x + 104, at.y + 136, name.toUpperCase(), {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: "8px",
      color: "#1b1b2a",
      align: "center",
      backgroundColor: "#e0b870",
      padding: { x: 4, y: 3 },
    })
    .setOrigin(0.5, 0.5)
    .setDepth(foot + 1)
    .setResolution(2);
  addSolid(walls, { x: at.x, y: at.y, width: BOAT.width, height: BOAT.height });
}
