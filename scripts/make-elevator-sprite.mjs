/**
 * Draws the lift doors: public/sprites/animated_elevator_96x144.png
 *
 * The project had no lift art — the only animated opening was the swing door
 * — so this one is generated rather than drawn, which keeps it reproducible
 * and lets the palette be retuned in one place.
 *
 * Format matches the swing door so the door manager needs no special case:
 * five frames, closed at 0 and open at 4, three tiles tall, resting on the
 * floor. This one is two tiles wide because a lift car is.
 *
 *   node scripts/make-elevator-sprite.mjs
 */

import { deflateSync } from "zlib";
import { writeFileSync } from "fs";
import { join } from "path";

const FRAME_W = 96;
const FRAME_H = 144;
const FRAMES = 5;
const W = FRAME_W * FRAMES;
const H = FRAME_H;

// Sampled to sit with the room builder tileset: dark navy outlines, muted
// blue-greys, and the same warm amber the swing door uses for its trim.
const C = {
  clear: [0, 0, 0, 0],
  outline: [56, 56, 79, 255],
  steel: [138, 143, 163, 255],
  steelLit: [182, 188, 201, 255],
  steelDim: [95, 101, 119, 255],
  leaf: [154, 160, 178, 255],
  leafDim: [123, 129, 148, 255],
  shaft: [34, 34, 47, 255],
  shaftLit: [52, 52, 70, 255],
  amber: [232, 196, 106, 255],
};

const px = new Uint8Array(W * H * 4);

function set(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
  px[i + 3] = c[3];
}

function rect(x0, y0, x1, y1, c) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c);
}

function outlineRect(x0, y0, x1, y1, c) {
  for (let x = x0; x < x1; x++) {
    set(x, y0, c);
    set(x, y1 - 1, c);
  }
  for (let y = y0; y < y1; y++) {
    set(x0, y, c);
    set(x1 - 1, y, c);
  }
}

/** Geometry, in frame-local coordinates. */
const TOP = 6; // where the lintel starts
const LINTEL_H = 22;
const JAMB = 10; // side frame thickness
const SILL = 6; // threshold at the floor
const OPENING_L = JAMB;
const OPENING_R = FRAME_W - JAMB;
const MID = FRAME_W / 2;
const LEAF_TRAVEL = MID - JAMB - 2;

for (let f = 0; f < FRAMES; f++) {
  const ox = f * FRAME_W;
  const at = (x, y, c) => set(ox + x, y, c);
  const box = (x0, y0, x1, y1, c) => rect(ox + x0, y0, ox + x1, y1, c);
  const line = (x0, y0, x1, y1, c) => outlineRect(ox + x0, y0, ox + x1, y1, c);

  // Shaft behind everything, so an open door reveals depth rather than a hole.
  box(OPENING_L, TOP + LINTEL_H, OPENING_R, FRAME_H - SILL, C.shaft);
  // A slab of light at the back of the car, brighter as the doors part.
  const glow = Math.round((f / (FRAMES - 1)) * 10);
  if (glow) box(MID - glow, TOP + LINTEL_H + 8, MID + glow, FRAME_H - SILL - 8, C.shaftLit);

  // Door leaves, retracting into the jambs.
  const travel = Math.round((f / (FRAMES - 1)) * LEAF_TRAVEL);
  const leftEdge = MID - travel;
  const rightEdge = MID + travel;
  if (leftEdge > OPENING_L) {
    box(OPENING_L, TOP + LINTEL_H, leftEdge, FRAME_H - SILL, C.leaf);
    box(leftEdge - 2, TOP + LINTEL_H, leftEdge, FRAME_H - SILL, C.leafDim);
  }
  if (rightEdge < OPENING_R) {
    box(rightEdge, TOP + LINTEL_H, OPENING_R, FRAME_H - SILL, C.leaf);
    box(rightEdge, TOP + LINTEL_H, rightEdge + 2, FRAME_H - SILL, C.leafDim);
  }

  // Frame: jambs, lintel and threshold.
  box(0, TOP, JAMB, FRAME_H, C.steel);
  box(FRAME_W - JAMB, TOP, FRAME_W, FRAME_H, C.steel);
  box(0, TOP, FRAME_W, TOP + LINTEL_H, C.steel);
  box(0, FRAME_H - SILL, FRAME_W, FRAME_H, C.steelDim);

  // Lit edges catch the light from above, the way the tileset's metal does.
  box(0, TOP, FRAME_W, TOP + 2, C.steelLit);
  box(0, TOP, 2, FRAME_H, C.steelLit);
  box(FRAME_W - 2, TOP, FRAME_W, FRAME_H, C.steelDim);

  // Floor indicator: a lit strip that fills as the doors open.
  const lampW = 26;
  const lampX = MID - lampW / 2;
  box(lampX, TOP + 7, lampX + lampW, TOP + 14, C.shaft);
  const lit = Math.max(2, Math.round((f / (FRAMES - 1)) * (lampW - 4)));
  box(lampX + 2, TOP + 9, lampX + 2 + lit, TOP + 12, C.amber);
  line(lampX, TOP + 7, lampX + lampW, TOP + 14, C.outline);

  // Outline last so nothing paints over it.
  line(0, TOP, FRAME_W, FRAME_H, C.outline);
  line(OPENING_L, TOP + LINTEL_H, OPENING_R, FRAME_H - SILL + 1, C.outline);
  for (let y = TOP; y < FRAME_H; y++) at(JAMB - 1, y, C.outline);
  for (let y = TOP; y < FRAME_H; y++) at(OPENING_R, y, C.outline);
}

// ── PNG encoding ───────────────────────────────────────

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // truecolour with alpha
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(process.cwd(), "public", "sprites", "animated_elevator_96x144.png");
writeFileSync(out, png);
console.log(`wrote ${out} — ${W}x${H}, ${FRAMES} frames of ${FRAME_W}x${FRAME_H}`);
