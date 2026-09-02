/**
 * Oak Island: The Curse — the rules.
 *
 * A treasure hunter with a shovel, screen by screen across the island and
 * down the Money Pit. Nothing here draws; it is state and how it changes,
 * so it can be tested by walking a hunter about with no canvas in sight.
 */

import type { ArcadeInput } from "../types";
import {
  COLS,
  DAN,
  DAN_AGAIN,
  FLOOD_BLOCKED,
  INTRO,
  LEGEND,
  ROOMS,
  ROWS,
  SIGNS,
  START_ROOM,
  START_TILE,
  STONE_CIPHER,
  STONE_DARK,
  TILE,
  VAULT_LOCKED,
  VAULT_OPEN,
  WALKABLE,
  type EnemyKind,
  type Item,
  type RoomDef,
  type Tile,
} from "./world";

export type Dir = "up" | "down" | "left" | "right";

export const SPEED = 92;
export const MAX_HP = 6;
export const SWING_SECONDS = 0.22;
export const INVULN_SECONDS = 0.9;
/** Half the hunter's feet box. */
const HALF = 6;
/** Standing close enough to a thing to use it. */
const REACH = 14;

export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  /** Time left of the flash after a hit. */
  hit: number;
  /** Knockback still to travel. */
  kx: number;
  ky: number;
  /** For wanderers: where they are heading and for how long. */
  wx: number;
  wy: number;
  wander: number;
}

export interface EnemyDef {
  hp: number;
  speed: number;
  /** Half width of its body. */
  r: number;
  gold: number;
  chases: boolean;
  /** Passes through walls, as the dead do. */
  drifts: boolean;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  crab: { hp: 1, speed: 34, r: 8, gold: 1, chases: false, drifts: false },
  wisp: { hp: 1, speed: 58, r: 7, gold: 2, chases: true, drifts: false },
  skeleton: { hp: 2, speed: 48, r: 9, gold: 3, chases: true, drifts: false },
  ghost: { hp: 2, speed: 66, r: 9, gold: 5, chases: true, drifts: true },
};

/** Dan Blankenship stands by the path and hands out the shovel. */
export const DAN_TILE = { tx: 10, ty: 8 };

export interface OakState {
  room: string;
  /** The hunter's feet, in map pixels. */
  x: number;
  y: number;
  facing: Dir;
  moving: boolean;
  hp: number;
  invuln: number;
  swing: number;
  gold: number;
  items: Item[];
  /** Things used up: chests opened, holes dug, words heard. */
  done: string[];
  /** Rooms whose enemies are dead and stay dead. */
  cleared: string[];
  enemies: Enemy[];
  /** Lines waiting to be read; the world holds still while they are. */
  dialog: string[];
  title: boolean;
  won: boolean;
  over: boolean;
  /** A short notice: gold picked up, a room's name. */
  notice: string | null;
  noticeUntil: number;
  /** Where a tap asked the hunter to walk. */
  target: { x: number; y: number } | null;
  t: number;
  /** How the game ended, in words, for the panel. */
  ending: string | null;
  /** When the flood last explained itself, so it does not nag. */
  floodSaidAt: number;
  /** Just off a ladder: no climbing until the hunter has stepped clear of it. */
  onLadder: boolean;
  /** Sounds for the cabinet to play, by name, since the last frame. */
  sfx: string[];
  random: () => number;
}

export function createOakIsland(random: () => number = Math.random): OakState {
  const state: OakState = {
    room: START_ROOM,
    x: START_TILE.tx * TILE + TILE / 2,
    y: START_TILE.ty * TILE + TILE / 2,
    facing: "down",
    moving: false,
    hp: MAX_HP,
    invuln: 0,
    swing: 0,
    gold: 0,
    items: [],
    done: [],
    cleared: [],
    enemies: [],
    dialog: [],
    title: true,
    won: false,
    over: false,
    notice: null,
    noticeUntil: 0,
    target: null,
    t: 0,
    ending: null,
    floodSaidAt: -10,
    onLadder: false,
    sfx: [],
    random,
  };
  spawnEnemies(state);
  return state;
}

export function roomOf(state: OakState): RoomDef {
  return ROOMS[state.room];
}

export function tileAt(room: RoomDef, tx: number, ty: number): Tile {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return "wall";
  return LEGEND[room.rows[ty][tx]] ?? "wall";
}

export function has(state: OakState, item: Item): boolean {
  return state.items.includes(item);
}

function give(state: OakState, item: Item) {
  if (has(state, item)) return;
  state.items.push(item);
  state.sfx.push("pickup");
}

function say(state: OakState, lines: string[]) {
  state.dialog = [...lines];
}

function notice(state: OakState, text: string) {
  state.notice = text;
  state.noticeUntil = state.t + 2;
}

export function score(state: OakState): number {
  return state.gold * 10 + state.items.length * 100 + (state.won ? 1000 : 0);
}

/** Whether the hunter may stand on a tile. */
export function passable(state: OakState, tile: Tile): boolean {
  if (tile === "flood") return has(state, "fibre");
  return WALKABLE[tile];
}

function spawnEnemies(state: OakState) {
  const room = roomOf(state);
  state.enemies = state.cleared.includes(room.id)
    ? []
    : room.enemies.map((e) => ({
        kind: e.kind,
        x: e.tx * TILE + TILE / 2,
        y: e.ty * TILE + TILE / 2,
        hp: ENEMIES[e.kind].hp,
        hit: 0,
        kx: 0,
        ky: 0,
        wx: 0,
        wy: 0,
        wander: 0,
      }));
}

/**
 * Go to another screen, arriving at a given spot — or the nearest spot to
 * it the hunter can stand on. Two screens' openings do not always line up,
 * and an arrival inside a tree is a hunter who can never move again.
 */
export function enterRoom(
  state: OakState,
  id: string,
  x: number,
  y: number,
  along?: "edge-x" | "edge-y",
) {
  state.room = id;
  state.x = x;
  state.y = y;
  state.target = null;
  settle(state, along);
  spawnEnemies(state);
  notice(state, ROOMS[id].name);
  state.sfx.push("step");
}

/**
 * Nudge the hunter to the closest place that fits. Arriving across an
 * edge, look along that edge first: an arrival nudged inward can find
 * the edge tile behind it is a tree, and then there is no going back.
 */
export function settle(state: OakState, along?: "edge-x" | "edge-y") {
  if (fits(state, state.x, state.y)) return;
  const width = COLS * TILE;
  const height = ROWS * TILE;
  const clampX = (v: number) => Math.min(width - HALF, Math.max(HALF, v));
  const clampY = (v: number) => Math.min(height - HALF, Math.max(HALF, v));
  const nearest = (spots: { x: number; y: number }[]) => {
    let best: { x: number; y: number; d: number } | null = null;
    for (const spot of spots) {
      if (!fits(state, spot.x, spot.y)) continue;
      const d = Math.hypot(spot.x - state.x, spot.y - state.y);
      if (!best || d < best.d) best = { ...spot, d };
    }
    return best;
  };
  const edgeSpots =
    along === "edge-x"
      ? Array.from({ length: ROWS }, (_, ty) => ({ x: state.x, y: clampY(ty * TILE + TILE / 2) }))
      : along === "edge-y"
        ? Array.from({ length: COLS }, (_, tx) => ({ x: clampX(tx * TILE + TILE / 2), y: state.y }))
        : [];
  const everywhere: { x: number; y: number }[] = [];
  for (let ty = 0; ty < ROWS; ty++)
    for (let tx = 0; tx < COLS; tx++)
      everywhere.push({ x: clampX(tx * TILE + TILE / 2), y: clampY(ty * TILE + TILE / 2) });
  const best = nearest(edgeSpots) ?? nearest(everywhere);
  if (best) {
    state.x = best.x;
    state.y = best.y;
  }
}

/** Can the hunter's feet box sit at (x, y)? */
function fits(state: OakState, x: number, y: number): boolean {
  const room = roomOf(state);
  for (const [cx, cy] of [
    [x - HALF, y - HALF],
    [x + HALF, y - HALF],
    [x - HALF, y + HALF],
    [x + HALF, y + HALF],
  ]) {
    if (cx < 0 || cy < 0 || cx >= COLS * TILE || cy >= ROWS * TILE) continue;
    if (!passable(state, tileAt(room, Math.floor(cx / TILE), Math.floor(cy / TILE)))) return false;
  }
  return true;
}

/** Whether a move is stopped by the flood in particular, to say why. */
function floodAhead(state: OakState, x: number, y: number): boolean {
  if (has(state, "fibre")) return false;
  const room = roomOf(state);
  for (const [cx, cy] of [
    [x - HALF, y - HALF],
    [x + HALF, y - HALF],
    [x - HALF, y + HALF],
    [x + HALF, y + HALF],
  ]) {
    if (tileAt(room, Math.floor(cx / TILE), Math.floor(cy / TILE)) === "flood") return true;
  }
  return false;
}

const DELTA: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** The tile the hunter is facing. */
export function facingTile(state: OakState): { tx: number; ty: number; tile: Tile } {
  const [dx, dy] = DELTA[state.facing];
  const tx = Math.floor((state.x + dx * REACH) / TILE);
  const ty = Math.floor((state.y + dy * REACH) / TILE);
  return { tx, ty, tile: tileAt(roomOf(state), tx, ty) };
}

function nearDan(state: OakState): boolean {
  if (state.room !== "landing") return false;
  const dx = DAN_TILE.tx * TILE + TILE / 2 - state.x;
  const dy = DAN_TILE.ty * TILE + TILE / 2 - state.y;
  // Two tiles: close enough to be talking, not so close you must stand on him.
  return Math.hypot(dx, dy) < TILE * 2;
}

/** Use whatever is ahead, or swing the shovel. */
export function act(state: OakState) {
  if (nearDan(state)) {
    if (!state.done.includes("dan")) {
      state.done.push("dan");
      give(state, "shovel");
      say(state, DAN);
    } else say(state, DAN_AGAIN);
    return;
  }
  const ahead = facingTile(state);
  const key = `${state.room}:${ahead.tx}:${ahead.ty}`;
  switch (ahead.tile) {
    case "sign":
      if (state.room === "shaft90") {
        if (!has(state, "lantern")) {
          say(state, STONE_DARK);
        } else {
          give(state, "cipher");
          say(state, STONE_CIPHER);
        }
      } else say(state, SIGNS[state.room] ?? ["Weathered marks. Nothing you can read."]);
      return;
    case "dig":
      if (!has(state, "shovel")) {
        say(state, ["Soft sand, and something under it. You need a shovel."]);
      } else if (!state.done.includes(key)) {
        state.done.push(key);
        state.sfx.push("dig");
        give(state, "fibre");
        say(state, [
          "You dig. Coconut fibre, packed tight — from no tree that grows here.",
          "Sailors used it to keep water out of a hull. Or a pit.",
        ]);
      } else say(state, ["Nothing more under the sand."]);
      return;
    case "cache":
      if (!has(state, "shovel")) {
        say(state, ["The centre stone of Nolan's Cross. The ground is loose beneath it."]);
      } else if (!state.done.includes(key)) {
        state.done.push(key);
        state.sfx.push("dig");
        give(state, "cross");
        say(state, [
          "Beneath the centre stone: a small cross, cut from lead.",
          "Old. Older than the pit. The kind a Templar might have carried.",
        ]);
      } else say(state, ["The hollow beneath the stone is empty now."]);
      return;
    case "chest":
      if (!state.done.includes(key)) {
        state.done.push(key);
        give(state, "lantern");
        state.gold += 12;
        say(state, [
          "Ball's strongbox: a brass lantern, and coin he never spent.",
          "Twelve gold. The lantern lights the dark below.",
        ]);
      } else say(state, ["Empty, but for the smell of old money."]);
      return;
    case "vault":
      if (has(state, "cross") && has(state, "cipher")) {
        state.won = true;
        state.over = true;
        state.ending = "The vault is open";
        state.sfx.push("chime");
        say(state, VAULT_OPEN);
      } else {
        state.sfx.push("thud");
        say(state, VAULT_LOCKED);
      }
      return;
    default:
      if (has(state, "shovel") && state.swing <= 0) {
        state.swing = SWING_SECONDS;
        state.sfx.push("swing");
      }
  }
}

function hurt(state: OakState, fromX: number, fromY: number) {
  if (state.invuln > 0 || state.over) return;
  state.hp -= 1;
  state.invuln = INVULN_SECONDS;
  state.sfx.push("hurt");
  const dx = state.x - fromX;
  const dy = state.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const nx = state.x + (dx / len) * 14;
  const ny = state.y + (dy / len) * 14;
  if (fits(state, nx, ny)) {
    state.x = nx;
    state.y = ny;
  }
  if (state.hp <= 0) {
    state.hp = 0;
    state.over = true;
    state.ending = "The seventh";
    state.sfx.push("die");
  }
}

function swingHits(state: OakState, enemy: Enemy): boolean {
  const [dx, dy] = DELTA[state.facing];
  const cx = state.x + dx * 16;
  const cy = state.y + dy * 16;
  const r = ENEMIES[enemy.kind].r;
  return Math.abs(enemy.x - cx) <= 16 + r && Math.abs(enemy.y - cy) <= 16 + r;
}

function moveEnemy(state: OakState, enemy: Enemy, dt: number) {
  const def = ENEMIES[enemy.kind];
  let vx = 0;
  let vy = 0;
  if (enemy.kx || enemy.ky) {
    vx = enemy.kx;
    vy = enemy.ky;
    enemy.kx *= 0.8;
    enemy.ky *= 0.8;
    if (Math.abs(enemy.kx) < 2) enemy.kx = 0;
    if (Math.abs(enemy.ky) < 2) enemy.ky = 0;
  } else if (def.chases) {
    const dx = state.x - enemy.x;
    const dy = state.y - enemy.y;
    const len = Math.hypot(dx, dy) || 1;
    vx = (dx / len) * def.speed;
    vy = (dy / len) * def.speed;
  } else {
    enemy.wander -= dt;
    if (enemy.wander <= 0) {
      const angle = state.random() * Math.PI * 2;
      enemy.wx = Math.cos(angle);
      enemy.wy = Math.sin(angle);
      enemy.wander = 0.6 + state.random() * 1.4;
    }
    vx = enemy.wx * def.speed;
    vy = enemy.wy * def.speed;
  }
  const room = roomOf(state);
  const can = (x: number, y: number) => {
    if (x < def.r || y < def.r || x > COLS * TILE - def.r || y > ROWS * TILE - def.r) return false;
    if (def.drifts) return true;
    const tile = tileAt(room, Math.floor(x / TILE), Math.floor(y / TILE));
    return WALKABLE[tile] && tile !== "flood";
  };
  const nx = enemy.x + vx * dt;
  const ny = enemy.y + vy * dt;
  if (can(nx, enemy.y)) enemy.x = nx;
  else enemy.wx = -enemy.wx;
  if (can(enemy.x, ny)) enemy.y = ny;
  else enemy.wy = -enemy.wy;
}

export function stepOakIsland(state: OakState, input: ArcadeInput, dt: number) {
  state.t += dt;
  if (state.notice && state.t > state.noticeUntil) state.notice = null;
  const pressed = input.actionPressed || (input.tap !== null && nearTap(state, input.tap));

  if (state.title) {
    if (input.actionPressed || input.tap) {
      state.title = false;
      say(state, INTRO);
    }
    return;
  }
  if (state.dialog.length) {
    if (pressed || (input.tap && !nearTap(state, input.tap))) {
      state.dialog.shift();
      state.sfx.push("blip");
    }
    return;
  }
  if (state.over) return;

  if (state.invuln > 0) state.invuln = Math.max(0, state.invuln - dt);
  if (state.swing > 0) state.swing = Math.max(0, state.swing - dt);

  // A tap away from the hunter is somewhere to walk to.
  if (input.tap && !nearTap(state, input.tap)) {
    state.target = { x: input.tap.x, y: input.tap.y - MAP_TOP_OFFSET };
  }
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx || dy) state.target = null;
  else if (state.target) {
    const tx = state.target.x - state.x;
    const ty = state.target.y - state.y;
    if (Math.hypot(tx, ty) < 4) state.target = null;
    else {
      dx = Math.abs(tx) > 2 ? Math.sign(tx) : 0;
      dy = Math.abs(ty) > 2 ? Math.sign(ty) : 0;
    }
  }
  state.moving = !!(dx || dy);
  if (dx || dy) {
    if (Math.abs(dx) >= Math.abs(dy)) state.facing = dx > 0 ? "right" : "left";
    else state.facing = dy > 0 ? "down" : "up";
    const len = Math.hypot(dx, dy) || 1;
    const step = SPEED * dt * (tileUnder(state) === "swamp" ? 0.6 : 1);
    const nx = state.x + (dx / len) * step;
    const ny = state.y + (dy / len) * step;
    if (fits(state, nx, state.y)) state.x = nx;
    else if (floodAhead(state, nx, state.y)) blockedByFlood(state);
    if (fits(state, state.x, ny)) state.y = ny;
    else if (floodAhead(state, state.x, ny)) blockedByFlood(state);
  }

  if (pressed) act(state);

  crossEdges(state);
  climb(state);

  // Enemies move, bite, and take the shovel.
  const survivors: Enemy[] = [];
  for (const enemy of state.enemies) {
    moveEnemy(state, enemy, dt);
    if (enemy.hit > 0) enemy.hit = Math.max(0, enemy.hit - dt);
    const def = ENEMIES[enemy.kind];
    if (state.swing > 0 && enemy.hit <= 0 && swingHits(state, enemy)) {
      enemy.hp -= 1;
      enemy.hit = 0.3;
      state.sfx.push("hit");
      const [ddx, ddy] = DELTA[state.facing];
      enemy.kx = ddx * 160;
      enemy.ky = ddy * 160;
      if (enemy.hp <= 0) {
        state.gold += def.gold;
        notice(state, `+${def.gold} gold`);
        continue;
      }
    }
    if (Math.abs(enemy.x - state.x) < def.r + HALF && Math.abs(enemy.y - state.y) < def.r + HALF) {
      hurt(state, enemy.x, enemy.y);
    }
    survivors.push(enemy);
  }
  state.enemies = survivors;
  if (
    survivors.length === 0 &&
    roomOf(state).enemies.length &&
    !state.cleared.includes(state.room)
  ) {
    state.cleared.push(state.room);
  }
}

/** Taps land in screen space; the map starts a strip down. */
export const MAP_TOP_OFFSET = 40;

function nearTap(state: OakState, tap: { x: number; y: number }): boolean {
  return Math.hypot(tap.x - state.x, tap.y - MAP_TOP_OFFSET - state.y) < TILE * 1.6;
}

function tileUnder(state: OakState): Tile {
  return tileAt(roomOf(state), Math.floor(state.x / TILE), Math.floor(state.y / TILE));
}

function blockedByFlood(state: OakState) {
  if (state.t - state.floodSaidAt < 4) return;
  state.floodSaidAt = state.t;
  say(state, FLOOD_BLOCKED);
}

function crossEdges(state: OakState) {
  const room = roomOf(state);
  const width = COLS * TILE;
  const height = ROWS * TILE;
  if (state.x < HALF && room.exits.left)
    enterRoom(state, room.exits.left, width - HALF - 1, state.y, "edge-x");
  else if (state.x > width - HALF && room.exits.right)
    enterRoom(state, room.exits.right, HALF + 1, state.y, "edge-x");
  else if (state.y < HALF && room.exits.up)
    enterRoom(state, room.exits.up, state.x, height - HALF - 1, "edge-y");
  else if (state.y > height - HALF && room.exits.down)
    enterRoom(state, room.exits.down, state.x, HALF + 1, "edge-y");
  else {
    state.x = Math.max(HALF, Math.min(width - HALF, state.x));
    state.y = Math.max(HALF, Math.min(height - HALF, state.y));
  }
}

/** Find a tile of a kind in a room, as a spot to stand. */
export function findTile(room: RoomDef, tile: Tile): { x: number; y: number } | null {
  for (let ty = 0; ty < ROWS; ty++)
    for (let tx = 0; tx < COLS; tx++)
      if (tileAt(room, tx, ty) === tile)
        return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  return null;
}

const LADDERS: Tile[] = ["ladder", "ladderDown", "ladderUp"];

function climb(state: OakState) {
  const room = roomOf(state);
  const under = tileUnder(state);
  if (!LADDERS.includes(under)) {
    state.onLadder = false;
    return;
  }
  // Arriving by ladder puts the hunter on the far end's ladder tile; that
  // must not send them straight back. Step off it first.
  if (state.onLadder) return;
  if ((under === "ladder" || under === "ladderDown") && room.ladderDownTo) {
    const below = ROOMS[room.ladderDownTo];
    // Below the top ladder: the gallery floor.
    const at = findTile(below, "ladderUp") ?? { x: TILE * 8, y: TILE * 2 };
    enterRoom(state, below.id, at.x, at.y + TILE);
    state.onLadder = true;
  } else if (under === "ladderUp" && room.ladderUpTo) {
    const above = ROOMS[room.ladderUpTo];
    // Above the bottom ladder: the floor, not the ladder, so the way down
    // is a step away rather than underfoot.
    const at = findTile(above, "ladderDown") ??
      findTile(above, "ladder") ?? { x: TILE * 8, y: TILE * 10 };
    enterRoom(state, above.id, at.x, at.y - TILE);
    state.onLadder = true;
  }
}
