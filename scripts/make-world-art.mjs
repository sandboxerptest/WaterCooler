/**
 * Draws the world map's pieces into public/sprites/world/.
 *
 * The project ships interior tilesets only, so the outside is generated —
 * but in the interiors' own palette, sampled from the Modern Office and
 * Generic sheets: dark navy outlines (#3a3a50 / #46465e), lilac-grey stone
 * (#d8d0e0 / #c6bdd5 / #a79796), warm wood (#ca8854 / #dbcaa9), and the
 * yellow and blue accents the furniture uses. Every object gets a three-tone
 * ramp and an outline, the way the furniture does, so it sits beside the
 * borrowed café props without a seam.
 *
 *   node scripts/make-world-art.mjs
 */

import { deflateSync } from "zlib";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const OUT = join(process.cwd(), "public", "sprites", "world");
mkdirSync(OUT, { recursive: true });

// The interiors' palette.
const P = {
  ink: [58, 58, 80, 255],
  ink2: [70, 70, 94, 255],
  slab: [216, 208, 224, 255],
  slabLit: [235, 228, 242, 255],
  grout: [198, 189, 213, 255],
  stone: [167, 151, 150, 255],
  stoneDark: [139, 139, 171, 255],
  steel: [108, 110, 133, 255],
  steelDark: [86, 89, 114, 255],
  wood: [202, 136, 84, 255],
  woodLit: [219, 202, 169, 255],
  woodDark: [139, 81, 77, 255],
  grass: [116, 160, 96, 255],
  grassDark: [100, 140, 80, 255],
  grassLit: [132, 176, 108, 255],
  leaf: [104, 145, 131, 255],
  leafLit: [130, 172, 150, 255],
  leafDark: [72, 108, 96, 255],
  water: [80, 167, 232, 255],
  waterLit: [204, 230, 236, 255],
  waterDark: [73, 149, 227, 255],
  yellow: [224, 184, 112, 255],
  yellowDark: [195, 170, 87, 255],
  red: [179, 94, 63, 255],
  blue: [73, 133, 204, 255],
  teal: [47, 125, 120, 255],
  tealDark: [31, 94, 90, 255],
  glass: [204, 230, 236, 255],
  glassLit: [240, 248, 250, 255],
  shadow: [40, 40, 60, 70],
};

function canvas(w, h) {
  const px = new Uint8Array(w * h * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
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
  const outline = (x0, y0, x1, y1, c = P.ink) => {
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
  const ring = (cx, cy, r, c) => {
    for (let y = -r - 1; y <= r + 1; y++)
      for (let x = -r - 1; x <= r + 1; x++) {
        const d = x * x + y * y;
        if (d <= (r + 1) * (r + 1) && d > (r - 0.5) * (r - 0.5)) set(cx + x, cy + y, c);
      }
  };
  const ellipse = (cx, cy, rx, ry, c) => {
    for (let y = -ry; y <= ry; y++)
      for (let x = -rx; x <= rx; x++)
        if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) set(cx + x, cy + y, c);
  };
  return { w, h, px, set, rect, outline, disc, ring, ellipse };
}
const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
};

// ── Ground tiles ──
function grass() {
  const c = canvas(48, 48);
  c.rect(0, 0, 48, 48, P.grass);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 48; x++) if (hash(x, y) < 0.05) c.set(x, y, P.grassDark);
  // a few tufts: three-pixel vees
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(hash(i, 11) * 42) + 2,
      y = Math.floor(hash(i, 23) * 42) + 3;
    c.set(x, y, P.grassLit);
    c.set(x - 1, y + 1, P.grassLit);
    c.set(x + 1, y + 1, P.grassLit);
    c.set(x, y + 1, P.grassDark);
  }
  return c;
}
function paving() {
  // 2x2 slabs per tile with grout, a lit top-left corner each
  const c = canvas(48, 48);
  c.rect(0, 0, 48, 48, P.slab);
  for (const [sx, sy] of [
    [0, 0],
    [24, 0],
    [0, 24],
    [24, 24],
  ]) {
    c.rect(sx + 1, sy + 1, sx + 8, sy + 3, P.slabLit);
    c.rect(sx + 1, sy + 1, sx + 3, sy + 8, P.slabLit);
  }
  for (let i = 0; i < 48; i++) {
    c.set(i, 23, P.grout);
    c.set(23, i, P.grout);
    c.set(i, 47, P.grout);
    c.set(47, i, P.grout);
  }
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 48; x++) if (hash(x + 7, y + 3) < 0.02) c.set(x, y, P.grout);
  return c;
}
function kerb() {
  // paving with a stone kerb along the top edge, for where paving meets grass
  const c = paving();
  c.rect(0, 0, 48, 6, P.stone);
  c.rect(0, 0, 48, 2, P.slabLit);
  c.rect(0, 6, 48, 7, P.ink2);
  return c;
}

// ── Props: one sheet, each prop in a named rectangle ──
const props = canvas(768, 128);
const frames = {};
let cursor = 0;
function slot(name, w, h, draw) {
  const x0 = cursor;
  frames[name] = { x: x0, y: 0, width: w, height: h };
  draw((x, y, c) => props.set(x0 + x, y, c), {
    rect: (a, b, c2, d, e) => props.rect(x0 + a, b, x0 + c2, d, e),
    outline: (a, b, c2, d, e) => props.outline(x0 + a, b, x0 + c2, d, e),
    disc: (a, b, r, e) => props.disc(x0 + a, b, r, e),
    ring: (a, b, r, e) => props.ring(x0 + a, b, r, e),
    ellipse: (a, b, rx, ry, e) => props.ellipse(x0 + a, b, rx, ry, e),
  });
  cursor += w + 8;
}
slot("tree", 96, 120, (set, d) => {
  d.ellipse(48, 112, 30, 8, P.shadow);
  d.rect(42, 80, 54, 112, P.woodDark);
  d.rect(45, 80, 50, 112, P.wood);
  d.outline(41, 80, 55, 113);
  d.disc(48, 50, 34, P.ink);
  d.disc(48, 50, 32, P.leafDark);
  d.disc(44, 44, 26, P.leaf);
  d.disc(38, 36, 14, P.leafLit);
  d.disc(66, 58, 12, P.ink);
  d.disc(66, 58, 10, P.leaf);
  d.disc(28, 62, 11, P.ink);
  d.disc(28, 62, 9, P.leafDark);
});
slot("bush", 64, 48, (set, d) => {
  d.ellipse(32, 44, 24, 5, P.shadow);
  d.ellipse(32, 26, 28, 16, P.ink);
  d.ellipse(32, 26, 26, 14, P.leafDark);
  d.ellipse(28, 22, 18, 10, P.leaf);
  d.ellipse(24, 18, 9, 5, P.leafLit);
  for (const [fx, fy, col] of [
    [16, 26, P.red],
    [40, 30, P.yellow],
    [46, 20, P.blue],
  ]) {
    set(fx, fy, col);
    set(fx + 1, fy, col);
    set(fx, fy + 1, col);
    set(fx + 1, fy + 1, col);
  }
});
slot("lamp", 32, 96, (set, d) => {
  d.ellipse(16, 92, 10, 3, P.shadow);
  d.rect(13, 20, 19, 90, P.steelDark);
  d.rect(14, 20, 16, 90, P.steel);
  d.outline(12, 20, 20, 91);
  d.rect(8, 86, 24, 92, P.steelDark);
  d.outline(8, 86, 24, 92);
  d.rect(6, 6, 26, 22, P.ink);
  d.rect(8, 8, 24, 20, P.yellow);
  d.rect(10, 10, 16, 14, P.slabLit);
  d.rect(12, 2, 20, 6, P.ink2);
});
slot("bench", 96, 48, (set, d) => {
  d.ellipse(48, 44, 40, 4, P.shadow);
  d.rect(6, 30, 12, 44, P.ink);
  d.rect(84, 30, 90, 44, P.ink);
  d.rect(7, 31, 11, 43, P.steelDark);
  d.rect(85, 31, 89, 43, P.steelDark);
  for (const y of [14, 20]) {
    d.rect(4, y, 92, y + 4, P.wood);
    d.rect(4, y, 92, y + 1, P.woodLit);
    d.outline(3, y - 1, 93, y + 5);
  }
  d.rect(4, 26, 92, 32, P.wood);
  d.rect(4, 26, 92, 27, P.woodLit);
  d.outline(3, 25, 93, 33);
});
slot("fountain", 144, 96, (set, d) => {
  d.ellipse(72, 88, 66, 8, P.shadow);
  d.ellipse(72, 60, 66, 30, P.ink);
  d.ellipse(72, 60, 64, 28, P.stoneDark);
  d.ellipse(72, 58, 60, 24, P.slab);
  d.ellipse(72, 56, 56, 20, P.ink);
  d.ellipse(72, 56, 54, 18, P.waterDark);
  d.ellipse(72, 54, 46, 14, P.water);
  for (const [rx, ry] of [
    [30, 8],
    [16, 4],
  ])
    d.ring(72, 54, rx, P.waterLit);
  d.rect(64, 20, 80, 56, P.ink);
  d.rect(66, 20, 78, 56, P.stone);
  d.rect(66, 20, 70, 56, P.slab);
  d.ellipse(72, 20, 14, 5, P.ink);
  d.ellipse(72, 20, 12, 3, P.water);
  d.rect(70, 4, 74, 20, P.waterLit);
  d.rect(71, 2, 73, 6, P.glassLit);
});
slot("fountain2", 144, 96, (set, d) => {
  d.ellipse(72, 88, 66, 8, P.shadow);
  d.ellipse(72, 60, 66, 30, P.ink);
  d.ellipse(72, 60, 64, 28, P.stoneDark);
  d.ellipse(72, 58, 60, 24, P.slab);
  d.ellipse(72, 56, 56, 20, P.ink);
  d.ellipse(72, 56, 54, 18, P.waterDark);
  d.ellipse(72, 54, 46, 14, P.water);
  for (const [rx, ry] of [
    [38, 10],
    [22, 6],
    [8, 2],
  ])
    d.ring(72, 54, rx, P.waterLit);
  d.rect(64, 20, 80, 56, P.ink);
  d.rect(66, 20, 78, 56, P.stone);
  d.rect(66, 20, 70, 56, P.slab);
  d.ellipse(72, 20, 14, 5, P.ink);
  d.ellipse(72, 20, 12, 3, P.waterLit);
  d.rect(70, 2, 74, 20, P.waterLit);
  d.rect(68, 0, 76, 4, P.glassLit);
});
slot("planter", 64, 48, (set, d) => {
  d.ellipse(32, 44, 26, 4, P.shadow);
  d.rect(8, 22, 56, 44, P.wood);
  d.rect(8, 22, 56, 26, P.woodLit);
  d.rect(8, 40, 56, 44, P.woodDark);
  d.outline(7, 21, 57, 45);
  d.ellipse(32, 18, 22, 8, P.ink);
  d.ellipse(32, 18, 20, 6, P.leafDark);
  d.ellipse(28, 16, 12, 4, P.leaf);
  for (const [fx, col] of [
    [16, P.red],
    [26, P.yellow],
    [36, P.blue],
    [46, P.red],
  ]) {
    set(fx, 14, col);
    set(fx + 1, 14, col);
    set(fx, 15, col);
    set(fx + 1, 15, col);
  }
});
slot("signpost", 48, 96, (set, d) => {
  d.ellipse(24, 92, 8, 3, P.shadow);
  d.rect(21, 30, 27, 90, P.woodDark);
  d.rect(22, 30, 25, 90, P.wood);
  d.outline(20, 30, 28, 91);
  d.rect(4, 8, 44, 30, P.woodLit);
  d.rect(4, 8, 44, 11, P.slabLit);
  d.outline(3, 7, 45, 31);
  d.rect(10, 16, 38, 18, P.ink2);
  d.rect(10, 22, 30, 24, P.ink2);
});
frames.fountain.animateWith = "fountain2";

// ── Buildings ──
const W = 288,
  H = 288;
function castle() {
  const c = canvas(W, H);
  c.rect(0, 252, W, 268, P.shadow);
  // keep
  c.rect(48, 96, 240, 258, P.stoneDark);
  for (let y = 100; y < 258; y += 12)
    for (let x = 48 + ((y / 12) % 2) * 12; x < 240; x += 24) {
      c.rect(x + 1, y, x + 22, y + 10, [176, 177, 196, 255]);
      c.rect(x + 1, y, x + 22, y + 2, P.slabLit);
    }
  // towers
  for (const tx of [12, 228]) {
    c.rect(tx, 60, tx + 48, 258, P.stoneDark);
    for (let y = 64; y < 258; y += 12)
      for (let x = tx + ((y / 12) % 2) * 6; x < tx + 44; x += 24) {
        c.rect(x + 1, y, x + 20, y + 10, [176, 177, 196, 255]);
        c.rect(x + 1, y, x + 20, y + 2, P.slabLit);
      }
    c.rect(tx - 4, 48, tx + 52, 60, P.tealDark);
    c.rect(tx + 2, 30, tx + 46, 48, P.teal);
    c.rect(tx + 6, 30, tx + 20, 48, [66, 150, 144, 255]);
    c.outline(tx - 4, 48, tx + 52, 60);
    c.outline(tx + 2, 30, tx + 46, 49);
    c.outline(tx, 58, tx + 48, 258);
    // banner
    c.rect(tx + 18, 8, tx + 30, 30, P.yellow);
    c.rect(tx + 18, 8, tx + 30, 12, P.red);
    c.outline(tx + 17, 7, tx + 31, 31);
    c.rect(tx + 23, 2, tx + 25, 8, P.ink);
  }
  // battlements + roof
  for (let x = 48; x < 240; x += 24) {
    c.rect(x, 82, x + 12, 96, P.stoneDark);
    c.rect(x + 1, 82, x + 11, 85, P.slabLit);
    c.outline(x, 82, x + 12, 97);
  }
  c.rect(60, 70, 228, 82, P.teal);
  c.rect(60, 70, 228, 73, [66, 150, 144, 255]);
  c.outline(60, 70, 228, 83);
  // windows with sills
  for (const wx of [84, 132, 180]) {
    c.rect(wx - 2, 158, wx + 20, 162, P.slabLit);
    c.outline(wx - 2, 158, wx + 20, 163);
    c.rect(wx, 126, wx + 18, 158, P.ink);
    c.rect(wx + 3, 129, wx + 15, 150, P.glass);
    c.rect(wx + 3, 129, wx + 8, 136, P.glassLit);
  }
  for (const tx of [22, 238]) {
    c.rect(tx, 90, tx + 14, 116, P.ink);
    c.rect(tx + 3, 93, tx + 11, 108, P.glass);
    c.rect(tx + 3, 93, tx + 6, 98, P.glassLit);
  }
  // arched door with stone ring and steps
  const dx = (W - 48) / 2;
  c.disc(dx + 24, 206, 30, P.ink);
  c.disc(dx + 24, 206, 28, P.stone);
  c.rect(dx - 6, 206, dx + 54, 258, P.stone);
  c.outline(dx - 6, 206, dx + 54, 258);
  c.disc(dx + 24, 206, 22, P.ink);
  c.rect(dx + 2, 206, dx + 46, 258, P.ink);
  c.disc(dx + 24, 206, 20, [64, 52, 46, 255]);
  c.rect(dx + 4, 206, dx + 44, 258, [64, 52, 46, 255]);
  c.rect(dx + 22, 190, dx + 26, 258, [42, 34, 30, 255]);
  c.rect(dx - 12, 258, dx + 60, 266, P.slab);
  c.rect(dx - 12, 258, dx + 60, 260, P.slabLit);
  c.outline(dx - 12, 257, dx + 60, 267);
  // sign
  c.rect(dx - 40, 166, dx + 88, 184, P.yellow);
  c.rect(dx - 40, 166, dx + 88, 169, P.slabLit);
  c.outline(dx - 40, 165, dx + 88, 185);
  c.outline(48, 82, 240, 259);
  return c;
}
function office() {
  const c = canvas(W, H);
  c.rect(0, 252, W, 268, P.shadow);
  const wall = [94, 127, 163, 255],
    wallDark = [70, 99, 131, 255];
  c.rect(24, 48, 264, 258, wall);
  c.rect(24, 48, 264, 60, P.ink2);
  c.rect(24, 60, 264, 64, wallDark);
  // rooftop unit
  c.rect(200, 30, 240, 48, P.steelDark);
  c.rect(202, 32, 238, 40, P.steel);
  c.outline(200, 30, 240, 49);
  c.rect(206, 24, 212, 30, P.ink2);
  // ground floor band, darker
  c.rect(24, 208, 264, 258, wallDark);
  // window grid with sills
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 5; col++) {
      const wx = 40 + col * 44,
        wy = 74 + row * 34;
      c.rect(wx, wy, wx + 32, wy + 24, P.ink);
      c.rect(wx + 2, wy + 2, wx + 30, wy + 22, P.glass);
      c.rect(wx + 2, wy + 2, wx + 12, wy + 9, P.glassLit);
      c.rect(wx - 2, wy + 24, wx + 34, wy + 27, P.slabLit);
      c.outline(wx - 2, wy + 24, wx + 34, wy + 28);
    }
  // awning over the door: yellow and white stripes
  for (let x = 84; x < 204; x += 12) {
    c.rect(x, 200, x + 6, 216, P.yellow);
    c.rect(x + 6, 200, x + 12, 216, P.slabLit);
  }
  c.rect(84, 196, 204, 200, P.yellowDark);
  c.outline(84, 196, 204, 217);
  // sign band
  c.rect(96, 178, 192, 194, P.yellow);
  c.rect(96, 178, 192, 181, P.slabLit);
  c.outline(96, 177, 192, 195);
  // glass double door
  const dx = (W - 72) / 2;
  c.rect(dx - 4, 214, dx + 76, 258, P.ink);
  c.rect(dx, 218, dx + 72, 258, [159, 211, 234, 255]);
  c.rect(dx + 34, 218, dx + 38, 258, P.ink);
  c.rect(dx + 4, 222, dx + 20, 236, P.glassLit);
  c.rect(dx + 42, 222, dx + 58, 236, P.glassLit);
  c.rect(dx - 8, 258, dx + 80, 266, P.slab);
  c.rect(dx - 8, 258, dx + 80, 260, P.slabLit);
  c.outline(dx - 8, 257, dx + 80, 267);
  c.outline(24, 48, 264, 259);
  return c;
}

// ── PNG ──
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
  const raw = Buffer.alloc(c.h * (c.w * 4 + 1));
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 4 + 1)] = 0;
    Buffer.from(c.px.buffer, y * c.w * 4, c.w * 4).copy(raw, y * (c.w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
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
  console.log(`wrote ${name} ${c.w}x${c.h}`);
}
save("grass_48.png", grass());
save("paving_48.png", paving());
save("kerb_48.png", kerb());
save("props.png", props);
writeFileSync(join(OUT, "props.json"), JSON.stringify(frames, null, 2));
save("building_castle.png", castle());
save("building_office.png", office());
