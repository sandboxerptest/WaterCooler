/**
 * Draws the lobby games — the ping pong table and the pinball machine — in
 * the interiors' palette.
 *
 *   node scripts/make-game-sprites.mjs
 */
import { deflateSync } from "zlib";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const OUT = join(process.cwd(), "public", "sprites");
mkdirSync(OUT, { recursive: true });

const ink = [58, 58, 80, 255];
const top = [47, 125, 120, 255];
const topLit = [66, 150, 144, 255];
const topDark = [31, 94, 90, 255];
const line = [235, 228, 242, 255];
const net = [216, 208, 224, 255];
const netDark = [167, 151, 150, 255];
const leg = [108, 110, 133, 255];
const legDark = [86, 89, 114, 255];
const shadow = [40, 40, 60, 70];

function canvas(W, H) {
  const px = new Uint8Array(W * H * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    if (c[3] === 255) {
      px.set(c, i);
      return;
    }
    const a = c[3] / 255;
    px[i] = px[i] * (1 - a) + c[0] * a;
    px[i + 1] = px[i + 1] * (1 - a) + c[1] * a;
    px[i + 2] = px[i + 2] * (1 - a) + c[2] * a;
    px[i + 3] = Math.max(px[i + 3], c[3]);
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c);
  };
  const outline = (x0, y0, x1, y1, c = ink) => {
    for (let x = x0; x < x1; x++) {
      set(x, y0, c);
      set(x, y1 - 1, c);
    }
    for (let y = y0; y < y1; y++) {
      set(x0, y, c);
      set(x1 - 1, y, c);
    }
  };
  const disc = (cx, cy, r, c) => {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) set(cx + x, cy + y, c);
  };
  return { W, H, px, set, rect, outline, disc };
}

function table() {
  const c = canvas(96, 72);
  const { set, rect, outline } = c;
  // Shadow on the floor, then legs, then the top so it covers their tops.
  for (let y = 60; y < 68; y++)
    for (let x = 6 + (y - 60); x < 92 - (y - 60); x++) set(x, y, shadow);
  for (const lx of [10, 80]) {
    rect(lx, 40, lx + 6, 62, legDark);
    rect(lx + 1, 40, lx + 3, 62, leg);
    outline(lx - 1, 40, lx + 7, 63);
  }
  rect(2, 8, 94, 44, ink);
  rect(3, 9, 93, 43, topDark);
  rect(4, 10, 92, 40, top);
  rect(4, 10, 92, 12, topLit);
  for (let x = 6; x < 90; x++) {
    set(x, 12, line);
    set(x, 37, line);
  }
  for (let y = 12; y < 38; y++) {
    set(6, y, line);
    set(89, y, line);
    set(47, y, line);
    set(48, y, line);
  }
  rect(44, 4, 52, 42, netDark);
  rect(45, 5, 51, 41, net);
  for (let y = 6; y < 40; y += 2) for (let x = 45; x < 51; x += 2) set(x, y, netDark);
  outline(43, 3, 53, 43);
  return c;
}

const cabinet = [86, 89, 114, 255];
const cabinetLit = [139, 139, 171, 255];
const cabinetDark = [58, 58, 80, 255];
const glass = [204, 230, 236, 255];
const field = [47, 125, 120, 255];
const fieldLit = [66, 150, 144, 255];
const lane = [31, 94, 90, 255];
const yellow = [242, 178, 43, 255];
const red = [179, 94, 63, 255];
const blue = [73, 133, 204, 255];
const white = [235, 228, 242, 255];
const silver = [216, 208, 224, 255];

function pinball() {
  const c = canvas(96, 120);
  const { set, rect, outline, disc } = c;
  // Shadow, legs.
  for (let y = 108; y < 116; y++)
    for (let x = 8 + (y - 108) / 2; x < 88 - (y - 108) / 2; x++) set(x | 0, y, shadow);
  for (const lx of [12, 78]) {
    rect(lx, 92, lx + 6, 110, legDark);
    rect(lx + 1, 92, lx + 3, 110, leg);
    outline(lx - 1, 92, lx + 7, 111);
  }
  // Backbox: tall, at the top, with lights and a star on the glass.
  rect(14, 2, 82, 40, ink);
  rect(15, 3, 81, 39, cabinetDark);
  rect(18, 6, 78, 34, blue);
  rect(18, 6, 78, 9, [120, 170, 230, 255]);
  for (let x = 20; x < 78; x += 6) set(x, 31, x % 12 ? yellow : red);
  // a star
  const star = [
    [47, 12],
    [46, 13],
    [47, 13],
    [48, 13],
    [44, 14],
    [45, 14],
    [46, 14],
    [47, 14],
    [48, 14],
    [49, 14],
    [50, 14],
    [45, 15],
    [46, 15],
    [47, 15],
    [48, 15],
    [49, 15],
    [46, 16],
    [47, 16],
    [48, 16],
    [45, 17],
    [47, 17],
    [49, 17],
    [44, 18],
    [50, 18],
  ];
  for (const [x, y] of star) set(x, y, yellow);
  rect(24, 22, 72, 24, white);
  rect(28, 26, 68, 28, white);
  // Cabinet body below the backbox, seen a little from above: the glass
  // playfield slopes toward the player.
  rect(6, 40, 90, 96, ink);
  rect(7, 41, 89, 95, cabinet);
  rect(7, 41, 89, 44, cabinetLit);
  rect(10, 46, 86, 90, ink);
  rect(11, 47, 85, 89, field);
  rect(11, 47, 85, 50, fieldLit);
  // Lanes down the sides, bumpers, and the flippers at the bottom.
  for (let y = 50; y < 86; y++) {
    set(14, y, lane);
    set(81, y, lane);
  }
  for (const [bx, by, col] of [
    [34, 58, red],
    [58, 56, yellow],
    [46, 68, blue],
  ]) {
    disc(bx, by, 6, ink);
    disc(bx, by, 5, col);
    disc(bx - 2, by - 2, 2, white);
  }
  for (let i = 0; i < 4; i++) set(20 + i * 4, 76, yellow);
  for (let i = 0; i < 4; i++) set(66 + i * 4, 76, yellow);
  // flippers: two angled bars meeting near the drain
  for (let i = 0; i < 12; i++) {
    set(28 + i, 84 + (i >> 2), yellow);
    set(28 + i, 85 + (i >> 2), yellow);
    set(67 - i, 84 + (i >> 2), yellow);
    set(67 - i, 85 + (i >> 2), yellow);
  }
  outline(26, 82, 42, 89);
  outline(54, 82, 70, 89);
  // the ball
  disc(24, 62, 3, ink);
  disc(24, 62, 2, silver);
  set(23, 61, white);
  // glass glint across the field
  for (let i = 0; i < 26; i++) set(60 + i, 52 + i, [255, 255, 255, 60]);
  // coin door and start button on the front
  rect(40, 92, 56, 95, cabinetDark);
  set(46, 93, red);
  set(48, 93, red);
  return c;
}

/**
 * The arcade cabinet: upright, a marquee on top, a screen with something
 * on it, a control panel with a stick and three buttons, a coin door.
 */
function arcade() {
  const c = canvas(96, 120);
  const { set, rect, outline, disc } = c;
  const purple = [92, 64, 140, 255];
  const purpleLit = [128, 96, 184, 255];
  const purpleDark = [64, 44, 100, 255];
  const screen = [16, 27, 36, 255];
  const green = [95, 191, 79, 255];
  const orange = [242, 145, 61, 255];
  // Shadow and feet.
  for (let y = 110; y < 116; y++)
    for (let x = 12 + (y - 110) / 2; x < 84 - (y - 110) / 2; x++) set(x | 0, y, shadow);
  rect(16, 106, 80, 110, ink);
  // Body: tall, narrower at the top, with lit edges.
  rect(16, 2, 80, 108, ink);
  rect(17, 3, 79, 107, purple);
  rect(17, 3, 79, 5, purpleLit);
  for (let y = 3; y < 107; y++) {
    set(17, y, purpleLit);
    set(78, y, purpleDark);
  }
  // Marquee with lights and the word.
  rect(20, 6, 76, 20, ink);
  rect(21, 7, 75, 19, cabinetDark);
  rect(23, 9, 73, 17, red);
  for (let x = 24; x < 72; x += 4) set(x, 8, x % 8 ? yellow : white);
  for (let x = 24; x < 72; x += 4) set(x, 18, x % 8 ? yellow : white);
  // "ARCADE" as a row of blocky letters.
  const letters = [
    [26, 12, 3],
    [26, 13, 1],
    [28, 13, 1],
    [26, 14, 3],
    [26, 15, 1],
    [28, 15, 1],
    [31, 12, 3],
    [31, 13, 1],
    [33, 13, 1],
    [31, 14, 3],
    [31, 15, 1],
    [33, 15, 1],
    [36, 12, 3],
    [36, 13, 1],
    [36, 14, 1],
    [36, 15, 3],
    [41, 12, 3],
    [41, 13, 1],
    [43, 13, 1],
    [41, 14, 3],
    [41, 15, 1],
    [43, 15, 1],
    [46, 12, 2],
    [46, 13, 1],
    [48, 13, 1],
    [46, 14, 1],
    [48, 14, 1],
    [46, 15, 2],
    [51, 12, 3],
    [51, 13, 1],
    [51, 14, 2],
    [51, 15, 3],
    [56, 12, 3],
    [56, 13, 1],
    [56, 14, 3],
    [56, 15, 1],
    [56, 16, 3],
  ];
  for (const [x, y, w] of letters) for (let i = 0; i < w; i++) set(x + i, y, white);
  // Screen: dark glass with a game on it — bricks, a ball, a snake, a bird.
  rect(20, 24, 76, 66, ink);
  rect(21, 25, 75, 65, screen);
  for (let i = 0; i < 6; i++) {
    set(26 + i * 8, 29, red);
    set(27 + i * 8, 29, red);
    set(28 + i * 8, 29, red);
    set(26 + i * 8, 31, orange);
    set(27 + i * 8, 31, orange);
    set(28 + i * 8, 31, orange);
    set(26 + i * 8, 33, yellow);
    set(27 + i * 8, 33, yellow);
    set(28 + i * 8, 33, yellow);
  }
  disc(52, 44, 1, white);
  for (let i = 0; i < 9; i++) set(26 + i, 52, green);
  for (let i = 0; i < 4; i++) set(34, 52 + i, green);
  set(35, 55, [182, 242, 122, 255]);
  disc(62, 50, 3, yellow);
  set(63, 49, white);
  set(66, 50, red);
  rect(40, 60, 56, 62, silver);
  for (let i = 0; i < 20; i++) set(24 + i, 27 + i, [255, 255, 255, 50]);
  // Control panel, sloped: a stick and three buttons.
  rect(18, 66, 78, 80, ink);
  rect(19, 67, 77, 79, cabinetDark);
  rect(19, 67, 77, 69, cabinetLit);
  disc(32, 74, 3, ink);
  disc(32, 71, 3, red);
  set(31, 70, white);
  for (let y = 72; y < 76; y++) set(32, y, silver);
  for (const [bx, col] of [
    [52, yellow],
    [60, green],
    [68, blue],
  ]) {
    disc(bx, 74, 3, ink);
    disc(bx, 74, 2, col);
    set(bx - 1, 73, white);
  }
  // Front with the coin door.
  rect(18, 80, 78, 106, ink);
  rect(19, 81, 77, 105, purpleDark);
  rect(38, 88, 58, 100, ink);
  rect(39, 89, 57, 99, cabinet);
  set(46, 92, yellow);
  set(50, 92, yellow);
  rect(44, 95, 52, 96, ink);
  outline(15, 1, 81, 109);
  return c;
}

let T = null;
const crc32 = (buf) => {
  if (!T) {
    T = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let x = n;
      for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
      T[n] = x;
    }
  }
  let x = -1;
  for (const b of buf) x = T[(x ^ b) & 0xff] ^ (x >>> 8);
  return (x ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function save(name, c) {
  const { W, H, px } = c;
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
  writeFileSync(
    join(OUT, name),
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
  console.log(`wrote ${name}`);
}
save("pingpong_table_96x72.png", table());
save("pinball_machine_96x120.png", pinball());
save("arcade_cabinet_96x120.png", arcade());
