/**
 * Draws public/characters/Character_Template_48x48.png — an empty sheet in
 * the game's exact format with the 48 animated slots outlined, so an artist
 * or an image tool has the grid to draw into rather than a description of it.
 *
 * Rows 1 and 2 carry the frames the game reads. Each slot shows its frame box,
 * the floor line the feet must stand on, and the collision box the game uses,
 * tinted per facing so right / up / left / down blocks read at a glance.
 *
 *   node scripts/make-character-template.mjs
 */

import { deflateSync } from "zlib";
import { writeFileSync } from "fs";
import { join } from "path";

const FW = 48,
  FH = 96,
  COLS = 56,
  W = COLS * FW,
  H = 1968;
const px = new Uint8Array(W * H * 4);
const set = (x, y, c) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  px.set(c, (y * W + x) * 4);
};
const hline = (x0, x1, y, c) => {
  for (let x = x0; x < x1; x++) set(x, y, c);
};
const vline = (x, y0, y1, c) => {
  for (let y = y0; y < y1; y++) set(x, y, c);
};

// Facing tints, right / up / left / down, faint so they never confuse the art.
const TINT = [
  [80, 140, 255, 28],
  [120, 220, 120, 28],
  [255, 170, 60, 28],
  [255, 90, 120, 28],
];
const EDGE = [60, 60, 80, 110];
const FLOOR = [220, 60, 60, 160];
const BODY = [60, 180, 200, 70];

for (const row of [1, 2]) {
  for (let col = 0; col < 24; col++) {
    const x0 = col * FW,
      y0 = row * FH;
    const tint = TINT[Math.floor(col / 6)];
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) set(x0 + x, y0 + y, tint);
    hline(x0, x0 + FW, y0, EDGE);
    hline(x0, x0 + FW, y0 + FH - 1, EDGE);
    vline(x0, y0, y0 + FH, EDGE);
    vline(x0 + FW - 1, y0, y0 + FH, EDGE);
    // collision box: 24x19 at (12, 72) — where the game thinks the feet are
    for (let y = 72; y < 91; y++) for (let x = 12; x < 36; x++) set(x0 + x, y0 + y, BODY);
    // floor line: the bottom of that box
    hline(x0 + 4, x0 + FW - 4, y0 + 91, FLOOR);
  }
}
// The one slot the HUD shows as the face: first idle-down frame, marked.
for (let t = 0; t < 3; t++) {
  const x0 = 18 * FW,
    y0 = FH;
  hline(x0 + t, x0 + FW - t, y0 + t, [255, 220, 60, 200]);
  hline(x0 + t, x0 + FW - t, y0 + FH - 1 - t, [255, 220, 60, 200]);
  vline(x0 + t, y0 + t, y0 + FH - t, [255, 220, 60, 200]);
  vline(x0 + FW - 1 - t, y0 + t, y0 + FH - t, [255, 220, 60, 200]);
}

// PNG
let T = null;
const crc32 = (buf) => {
  if (!T) {
    T = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      T[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = T[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const out = join(process.cwd(), "public", "characters", "Character_Template_48x48.png");
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
console.log(`wrote ${out} — ${W}x${H}`);
