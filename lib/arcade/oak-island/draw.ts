/**
 * Oak Island, drawn. Tiles, the hunter, the things that hunt him, the
 * strip of hearts and pockets, the words, and the dark of the shaft.
 */

import { FONT, SCREEN } from "../types";
import { COLS, ITEM_NAMES, MAP_TOP, ROWS, TILE, type Item, type Tile } from "./world";
import { DAN_TILE, ENEMIES, MAX_HP, has, roomOf, tileAt, type Enemy, type OakState } from "./game";

const ITEMS: Item[] = ["shovel", "fibre", "cross", "lantern", "cipher"];
const ITEM_GLYPH: Record<Item, string> = {
  shovel: "⛏",
  fibre: "≈",
  cross: "✝",
  lantern: "🔥",
  cipher: "⌘",
};

function tile(ctx: CanvasRenderingContext2D, kind: Tile, x: number, y: number, t: number) {
  switch (kind) {
    case "grass":
      ctx.fillStyle = "#4f9a44";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#5fb04f";
      ctx.fillRect(x + 3, y + 5, 2, 2);
      ctx.fillRect(x + 13, y + 12, 2, 2);
      return;
    case "sand":
      ctx.fillStyle = "#d9c47a";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#c9b264";
      ctx.fillRect(x + 6, y + 8, 2, 1);
      ctx.fillRect(x + 14, y + 15, 2, 1);
      return;
    case "water": {
      ctx.fillStyle = "#2d6f9a";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#4b93bf";
      const w = ((t * 10) | 0) % TILE;
      ctx.fillRect(x + ((w + 2) % TILE), y + 6, 6, 1);
      ctx.fillRect(x + ((w + 11) % TILE), y + 14, 5, 1);
      return;
    }
    case "tree":
      ctx.fillStyle = "#4f9a44";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#5a3b1e";
      ctx.fillRect(x + 8, y + 12, 4, 7);
      ctx.fillStyle = "#2f6f2f";
      ctx.beginPath();
      ctx.arc(x + 10, y + 8, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3f8a3a";
      ctx.beginPath();
      ctx.arc(x + 8, y + 6, 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "rock":
      ctx.fillStyle = "#4f9a44";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#6b6f7a";
      ctx.beginPath();
      ctx.ellipse(x + 10, y + 12, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9096a3";
      ctx.fillRect(x + 6, y + 8, 5, 2);
      return;
    case "path":
      ctx.fillStyle = "#a88a5a";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#987a4c";
      ctx.fillRect(x + 4, y + 10, 3, 2);
      ctx.fillRect(x + 12, y + 4, 3, 2);
      return;
    case "swamp":
      ctx.fillStyle = "#3e5a3a";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#2b4a3d";
      ctx.fillRect(x + 2, y + 4 + (((t * 6) | 0) % 3), 10, 2);
      ctx.fillStyle = "#6a8a4a";
      ctx.fillRect(x + 12, y + 13, 3, 3);
      return;
    case "wall":
      ctx.fillStyle = "#3a3648";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#4a4660";
      ctx.fillRect(x + 1, y + 1, 8, 8);
      ctx.fillRect(x + 11, y + 11, 8, 8);
      return;
    case "plank":
      ctx.fillStyle = "#7a5a34";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#5a3b1e";
      ctx.fillRect(x, y + 6, TILE, 1);
      ctx.fillRect(x, y + 13, TILE, 1);
      return;
    case "shaft":
      ctx.fillStyle = "#2a2434";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#332c40";
      ctx.fillRect(x + 4, y + 4, 2, 2);
      ctx.fillRect(x + 14, y + 12, 2, 2);
      return;
    case "dig":
      tile(ctx, "sand", x, y, t);
      ctx.strokeStyle = "#8a2f2f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 5, y + 5);
      ctx.lineTo(x + 15, y + 15);
      ctx.moveTo(x + 15, y + 5);
      ctx.lineTo(x + 5, y + 15);
      ctx.stroke();
      return;
    case "sign":
      ctx.fillStyle = "#4f9a44";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#8a8f9a";
      ctx.fillRect(x + 4, y + 3, 12, 14);
      ctx.fillStyle = "#2a2434";
      ctx.fillRect(x + 6, y + 6, 8, 1);
      ctx.fillRect(x + 6, y + 9, 6, 1);
      ctx.fillRect(x + 6, y + 12, 8, 1);
      return;
    case "boulder":
    case "cache":
      tile(ctx, "swamp", x, y, t);
      ctx.fillStyle = kind === "cache" ? "#8f8a7a" : "#7a7f8a";
      ctx.beginPath();
      ctx.ellipse(x + 10, y + 11, 9, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#b5b9c4";
      ctx.fillRect(x + 5, y + 6, 6, 2);
      return;
    case "chest":
      tile(ctx, "grass", x, y, t);
      ctx.fillStyle = "#8a5a2a";
      ctx.fillRect(x + 3, y + 6, 14, 10);
      ctx.fillStyle = "#c9a227";
      ctx.fillRect(x + 3, y + 10, 14, 2);
      ctx.fillRect(x + 9, y + 9, 2, 4);
      return;
    case "ladder":
    case "ladderDown":
      ctx.fillStyle = "#1a1620";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#a88a5a";
      ctx.fillRect(x + 5, y + 2, 2, 16);
      ctx.fillRect(x + 13, y + 2, 2, 16);
      for (let i = 4; i < 18; i += 4) ctx.fillRect(x + 5, y + i, 10, 2);
      return;
    case "ladderUp":
      tile(ctx, "shaft", x, y, t);
      ctx.fillStyle = "#a88a5a";
      ctx.fillRect(x + 5, y + 2, 2, 16);
      ctx.fillRect(x + 13, y + 2, 2, 16);
      for (let i = 4; i < 18; i += 4) ctx.fillRect(x + 5, y + i, 10, 2);
      return;
    case "vault":
      ctx.fillStyle = "#3a3648";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#6b6f7a";
      ctx.fillRect(x + 2, y + 2, 16, 16);
      ctx.fillStyle = "#c9a227";
      ctx.fillRect(x + 9, y + 5, 2, 10);
      ctx.fillRect(x + 6, y + 8, 8, 2);
      return;
    case "flood": {
      ctx.fillStyle = "#1e4a63";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#2e6a88";
      const w = ((t * 14) | 0) % TILE;
      ctx.fillRect(x + ((w + 4) % TILE), y + 9, 7, 1);
      return;
    }
  }
}

function hunter(ctx: CanvasRenderingContext2D, state: OakState) {
  const x = state.x;
  const y = state.y + MAP_TOP;
  if (state.invuln > 0 && ((state.t * 20) | 0) % 2 === 0) return;
  const bob = state.moving ? Math.sin(state.t * 16) * 1.5 : 0;
  // Legs, shirt, head, hat.
  ctx.fillStyle = "#3b3552";
  ctx.fillRect(x - 5, y - 2 + bob, 4, 8);
  ctx.fillRect(x + 1, y - 2 - bob, 4, 8);
  ctx.fillStyle = "#3f7a4a";
  ctx.fillRect(x - 7, y - 12, 14, 11);
  ctx.fillStyle = "#e8b88a";
  ctx.fillRect(x - 5, y - 20, 10, 8);
  ctx.fillStyle = "#6b4a2a";
  ctx.fillRect(x - 8, y - 22, 16, 3);
  ctx.fillRect(x - 5, y - 26, 10, 4);
  ctx.fillStyle = "#222";
  if (state.facing !== "up") {
    ctx.fillRect(state.facing === "left" ? x - 4 : x - 2, y - 17, 2, 2);
    if (state.facing !== "left") ctx.fillRect(x + 2, y - 17, 2, 2);
  }
  // The shovel, swung out ahead when it is swung.
  if (has(state, "shovel")) {
    const swing = state.swing > 0 ? 1 : 0;
    ctx.fillStyle = "#a88a5a";
    ctx.strokeStyle = "#8a8f9a";
    const dir = state.facing;
    const reach = swing ? 18 : 9;
    const sx = dir === "left" ? -reach : dir === "right" ? reach : dir === "up" ? 6 : -6;
    const sy = dir === "up" ? -reach - 8 : dir === "down" ? reach - 4 : -6;
    ctx.fillRect(x + sx - 1, y + sy - 6, 2, 12);
    ctx.fillStyle = "#c0c4cc";
    ctx.fillRect(x + sx - 3, y + sy + 4, 6, 5);
  }
}

function enemy(ctx: CanvasRenderingContext2D, e: Enemy, t: number) {
  const x = e.x;
  const y = e.y + MAP_TOP;
  const flash = e.hit > 0 && ((t * 30) | 0) % 2 === 0;
  switch (e.kind) {
    case "crab":
      ctx.fillStyle = flash ? "#fff" : "#d0553a";
      ctx.fillRect(x - 7, y - 4, 14, 8);
      ctx.fillRect(x - 10, y - 6, 3, 4);
      ctx.fillRect(x + 7, y - 6, 3, 4);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - 4, y - 3, 2, 2);
      ctx.fillRect(x + 2, y - 3, 2, 2);
      return;
    case "wisp": {
      const glow = 0.6 + Math.sin(t * 8) * 0.3;
      ctx.fillStyle = flash ? "#fff" : `rgba(150, 240, 200, ${glow})`;
      ctx.beginPath();
      ctx.arc(x, y - 4 + Math.sin(t * 5) * 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f1a12";
      ctx.fillRect(x - 3, y - 6, 2, 2);
      ctx.fillRect(x + 1, y - 6, 2, 2);
      return;
    }
    case "skeleton":
      ctx.fillStyle = flash ? "#fff" : "#e6e2d8";
      ctx.fillRect(x - 4, y - 18, 8, 7);
      ctx.fillRect(x - 5, y - 10, 10, 8);
      ctx.fillRect(x - 4, y - 2, 3, 6);
      ctx.fillRect(x + 1, y - 2, 3, 6);
      ctx.fillStyle = "#222";
      ctx.fillRect(x - 3, y - 16, 2, 2);
      ctx.fillRect(x + 1, y - 16, 2, 2);
      ctx.fillStyle = "#8a2f2f";
      ctx.fillRect(x - 8, y - 14, 3, 3);
      return;
    case "ghost": {
      const glow = 0.55 + Math.sin(t * 6) * 0.2;
      ctx.fillStyle = flash ? "#fff" : `rgba(200, 210, 255, ${glow})`;
      ctx.beginPath();
      ctx.arc(x, y - 10 + Math.sin(t * 4) * 2, 8, Math.PI, 0);
      ctx.lineTo(x + 8, y + 2);
      ctx.lineTo(x + 4, y - 2);
      ctx.lineTo(x, y + 2);
      ctx.lineTo(x - 4, y - 2);
      ctx.lineTo(x - 8, y + 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#1a1030";
      ctx.fillRect(x - 4, y - 12, 2, 3);
      ctx.fillRect(x + 2, y - 12, 2, 3);
      return;
    }
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawOakIsland(ctx: CanvasRenderingContext2D, state: OakState) {
  const { width, height } = SCREEN;
  ctx.font = `8px ${FONT}`;

  if (state.title) {
    ctx.fillStyle = "#0b1b2b";
    ctx.fillRect(0, 0, width, height);
    // A moonlit island: sea, a dark hump of land, one oak.
    ctx.fillStyle = "#e8e2d8";
    ctx.beginPath();
    ctx.arc(250, 90, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#123a52";
    ctx.fillRect(0, 250, width, 80);
    ctx.fillStyle = "#1e3a22";
    ctx.beginPath();
    ctx.ellipse(160, 262, 130, 30, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#3a2a18";
    ctx.fillRect(156, 200, 8, 40);
    ctx.fillStyle = "#254a28";
    ctx.beginPath();
    ctx.arc(160, 192, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c9a227";
    ctx.textAlign = "center";
    ctx.font = `18px ${FONT}`;
    ctx.fillText("OAK ISLAND", width / 2, 350);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = "#e6e2d8";
    ctx.fillText("THE CURSE", width / 2, 372);
    ctx.font = `8px ${FONT}`;
    ctx.fillStyle = "#a09888";
    ctx.fillText("SIX HAVE DIED. SEVEN MUST.", width / 2, 405);
    if (((state.t * 2) | 0) % 2 === 0) ctx.fillText("PRESS SPACE OR TAP", width / 2, 440);
    return;
  }

  const room = roomOf(state);
  for (let ty = 0; ty < ROWS; ty++)
    for (let tx = 0; tx < COLS; tx++)
      tile(ctx, tileAt(room, tx, ty), tx * TILE, MAP_TOP + ty * TILE, state.t);

  // Dan, by the path on the landing.
  if (state.room === "landing") {
    const x = DAN_TILE.tx * TILE + TILE / 2;
    const y = MAP_TOP + DAN_TILE.ty * TILE + TILE / 2;
    ctx.fillStyle = "#2a2434";
    ctx.fillRect(x - 5, y - 2, 4, 8);
    ctx.fillRect(x + 1, y - 2, 4, 8);
    ctx.fillStyle = "#8a2f2f";
    ctx.fillRect(x - 7, y - 12, 14, 11);
    ctx.fillStyle = "#e8b88a";
    ctx.fillRect(x - 5, y - 20, 10, 8);
    ctx.fillStyle = "#d8d0c0";
    ctx.fillRect(x - 6, y - 23, 12, 3);
    if (!state.done.includes("dan")) {
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText("!", x, y - 28);
    }
  }

  for (const e of state.enemies) enemy(ctx, e, state.t);
  hunter(ctx, state);

  // Underground it is dark, but for the lantern's circle, or the hunter's own arm's length.
  if (room.dark) {
    const radius = has(state, "lantern") ? 120 : 44;
    const gradient = ctx.createRadialGradient(
      state.x,
      state.y + MAP_TOP - 8,
      radius * 0.4,
      state.x,
      state.y + MAP_TOP - 8,
      radius,
    );
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,0.96)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, MAP_TOP, width, height - MAP_TOP);
  }

  // The strip: hearts, gold, pockets, where you are.
  ctx.fillStyle = "#12101a";
  ctx.fillRect(0, 0, width, MAP_TOP);
  for (let i = 0; i < MAX_HP / 2; i++) {
    const full = state.hp >= (i + 1) * 2;
    const half = !full && state.hp === i * 2 + 1;
    ctx.fillStyle = full || half ? "#e2554f" : "#3a2a30";
    ctx.fillRect(8 + i * 16, 8, 12, 10);
    if (half) {
      ctx.fillStyle = "#3a2a30";
      ctx.fillRect(14 + i * 16, 8, 6, 10);
    }
  }
  ctx.fillStyle = "#c9a227";
  ctx.textAlign = "left";
  ctx.font = `8px ${FONT}`;
  ctx.fillText(`GOLD ${state.gold}`, 8, 34);
  ITEMS.forEach((item, i) => {
    const owned = has(state, item);
    ctx.fillStyle = owned ? "#e6e2d8" : "#2a2634";
    ctx.fillRect(120 + i * 22, 6, 18, 18);
    if (owned) {
      ctx.fillStyle = "#12101a";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ITEM_GLYPH[item], 129 + i * 22, 20);
    }
  });
  ctx.font = `8px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillStyle = "#a09888";
  ctx.fillText(room.name.toUpperCase(), width - 6, 34);

  if (state.notice && !state.dialog.length) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.fillText(state.notice.toUpperCase(), width / 2, MAP_TOP + 16);
  }

  if (state.dialog.length) {
    const lines = wrap(ctx, state.dialog[0], width - 40);
    const boxH = 20 + lines.length * 13;
    ctx.fillStyle = "rgba(10, 8, 16, 0.92)";
    ctx.fillRect(10, height - boxH - 10, width - 20, boxH);
    ctx.strokeStyle = "#c9a227";
    ctx.lineWidth = 2;
    ctx.strokeRect(10, height - boxH - 10, width - 20, boxH);
    ctx.fillStyle = "#e6e2d8";
    ctx.textAlign = "left";
    lines.forEach((line, i) => ctx.fillText(line, 20, height - boxH + 4 + i * 13));
    ctx.fillStyle = "#a09888";
    ctx.textAlign = "right";
    ctx.fillText("▸", width - 18, height - 16);
  } else if (state.over) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, MAP_TOP, width, height - MAP_TOP);
    ctx.textAlign = "center";
    ctx.fillStyle = state.won ? "#c9a227" : "#e2554f";
    ctx.font = `12px ${FONT}`;
    ctx.fillText(state.won ? "THE VAULT IS OPEN" : "THE SEVENTH", width / 2, height / 2 - 10);
    ctx.font = `8px ${FONT}`;
    ctx.fillStyle = "#e6e2d8";
    ctx.fillText(state.won ? "YOU BROKE THE CURSE" : "THE CURSE HOLDS", width / 2, height / 2 + 12);
  }
}

/** For the item names in the panel's hints. */
export const ITEM_LABELS = ITEM_NAMES;
