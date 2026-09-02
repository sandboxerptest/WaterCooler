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

function asphalt() {
  const c = canvas(48, 48);
  c.rect(0, 0, 48, 48, [86, 89, 114, 255]);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 48; x++) if (hash(x + 3, y + 9) < 0.06) c.set(x, y, [78, 80, 104, 255]);
  // a bay line down the left edge: repeated, the tiles read as parking bays
  c.rect(0, 4, 3, 44, [216, 208, 224, 255]);
  return c;
}

/** A pond: water with ripples, a stone rim, and reeds at the edge. */
function pond() {
  const c = canvas(288, 192);
  c.ellipse(144, 140, 136, 44, P.shadow);
  c.ellipse(144, 110, 140, 70, P.ink);
  c.ellipse(144, 110, 138, 68, P.stoneDark);
  c.ellipse(144, 108, 132, 62, P.slab);
  c.ellipse(144, 108, 126, 56, P.ink);
  c.ellipse(144, 108, 124, 54, P.waterDark);
  c.ellipse(144, 104, 110, 44, P.water);
  for (const [rx, ry, cx, cy] of [
    [60, 20, 110, 100],
    [40, 14, 190, 96],
    [24, 8, 150, 120],
  ]) {
    for (let a = 0; a < 360; a += 4) {
      const x = Math.round(cx + Math.cos((a * Math.PI) / 180) * rx);
      const y = Math.round(cy + Math.sin((a * Math.PI) / 180) * ry);
      c.set(x, y, P.waterLit);
    }
  }
  // reeds
  for (const [x, y] of [
    [30, 120],
    [40, 128],
    [250, 118],
    [262, 126],
    [140, 160],
  ]) {
    for (let i = 0; i < 18; i++) c.set(x + (i % 3) - 1, y - i, i > 12 ? P.leafLit : P.leafDark);
    c.rect(x - 1, y - 20, x + 2, y - 15, P.wood);
  }
  // lily pads
  for (const [x, y] of [
    [120, 92],
    [176, 112],
    [96, 118],
  ]) {
    c.disc(x, y, 6, P.leafDark);
    c.disc(x - 1, y - 1, 4, P.leaf);
  }
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
  for (const rx of [30, 16]) d.ring(72, 54, rx, P.waterLit);
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
  for (const rx of [38, 22, 8]) d.ring(72, 54, rx, P.waterLit);
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

// ── More buildings ──
const wood = P.wood;
const woodLit = P.woodLit;
const woodDark = P.woodDark;

/** A timber-yard store: a broad shed with a pitched roof and lumber stacked beside it. */
function supply() {
  const c = canvas(W, H);
  c.rect(0, 252, W, 268, P.shadow);
  // walls: horizontal boards
  c.rect(24, 120, 264, 258, wood);
  for (let y = 124; y < 258; y += 8) c.rect(24, y, 264, y + 1, woodDark);
  c.rect(24, 120, 264, 124, woodLit);
  // pitched roof, corrugated
  for (let i = 0; i < 60; i++) {
    const x0 = 12 + i,
      x1 = 276 - i;
    c.rect(x0, 120 - i, x1, 121 - i, i % 6 < 3 ? P.steel : P.steelDark);
  }
  c.rect(12, 118, 276, 124, P.ink);
  for (let i = 0; i < 60; i++) {
    c.set(12 + i, 120 - i, P.ink);
    c.set(275 - i, 120 - i, P.ink);
  }
  c.rect(72, 60, 216, 62, P.ink);
  // big double door, open onto a dark interior, with lumber inside
  c.rect(104, 172, 184, 258, P.ink);
  c.rect(108, 176, 180, 258, [64, 52, 46, 255]);
  for (let y = 214; y < 258; y += 10) c.rect(112, y, 176, y + 6, woodLit);
  c.rect(142, 176, 146, 258, P.ink);
  // windows either side
  for (const wx of [40, 220]) {
    c.rect(wx, 150, wx + 28, 176, P.ink);
    c.rect(wx + 3, 153, wx + 25, 173, P.glass);
    c.rect(wx + 3, 153, wx + 10, 160, P.glassLit);
    c.rect(wx - 2, 176, wx + 30, 179, P.slabLit);
  }
  // sign board on the roof face
  c.rect(84, 76, 204, 108, P.yellow);
  c.rect(84, 76, 204, 79, P.slabLit);
  c.outline(83, 75, 205, 109);
  // lumber stack beside the shed
  for (let row = 0; row < 4; row++)
    for (let k = 0; k < 3; k++) {
      const x = 2 + k * 8 + (row % 2) * 4,
        y = 226 - row * 8;
      c.rect(x, y, x + 8, y + 8, wood);
      c.rect(x + 1, y + 1, x + 7, y + 3, woodLit);
      c.outline(x, y, x + 8, y + 8);
    }
  c.rect(24 - 2, 258, 264 + 2, 266, P.slab);
  c.rect(22, 258, 266, 260, P.slabLit);
  c.outline(22, 257, 266, 267);
  c.outline(24, 120, 264, 259);
  return c;
}

/** A concrete-block builder's merchant: heavy, square, with a red awning and stacked blocks. */
function blocks() {
  const c = canvas(W, H);
  c.rect(0, 252, W, 268, P.shadow);
  c.rect(24, 72, 264, 258, P.stoneDark);
  for (let y = 76; y < 258; y += 10)
    for (let x = 24 + ((y / 10) % 2) * 10; x < 264; x += 20) {
      c.rect(x + 1, y, x + 19, y + 8, P.stone);
      c.rect(x + 1, y, x + 19, y + 2, [190, 176, 175, 255]);
    }
  c.rect(24, 60, 264, 72, P.ink2);
  c.rect(30, 52, 258, 60, P.steelDark);
  c.outline(30, 52, 258, 61);
  // awning over the door and window band
  for (let x = 60; x < 228; x += 12) {
    c.rect(x, 190, x + 6, 208, P.red);
    c.rect(x + 6, 190, x + 12, 208, P.slabLit);
  }
  c.rect(60, 186, 228, 190, [140, 70, 50, 255]);
  c.outline(60, 186, 228, 209);
  // wide window band
  c.rect(40, 100, 248, 150, P.ink);
  c.rect(44, 104, 244, 146, P.glass);
  c.rect(44, 104, 100, 118, P.glassLit);
  for (const wx of [110, 176]) c.rect(wx, 104, wx + 4, 146, P.ink);
  // sign
  c.rect(80, 156, 208, 182, P.yellow);
  c.rect(80, 156, 208, 159, P.slabLit);
  c.outline(79, 155, 209, 183);
  // door
  const dx = (W - 72) / 2;
  c.rect(dx - 4, 210, dx + 76, 258, P.ink);
  c.rect(dx, 214, dx + 72, 258, [159, 211, 234, 255]);
  c.rect(dx + 34, 214, dx + 38, 258, P.ink);
  // stacked blocks by the door
  for (let row = 0; row < 3; row++)
    for (let k = 0; k < 2; k++) {
      const x = 4 + k * 12 + (row % 2) * 6,
        y = 240 - row * 10;
      c.rect(x, y, x + 12, y + 10, P.stone);
      c.rect(x + 1, y + 1, x + 11, y + 3, [190, 176, 175, 255]);
      c.outline(x, y, x + 12, y + 10);
    }
  c.rect(dx - 8, 258, dx + 80, 266, P.slab);
  c.rect(dx - 8, 258, dx + 80, 260, P.slabLit);
  c.outline(dx - 8, 257, dx + 80, 267);
  c.outline(24, 60, 264, 259);
  return c;
}

/** The campus gate: a wide glass headquarters behind a gateway with flags. */
function campus() {
  const CW = 384;
  const c = canvas(CW, H);
  c.rect(0, 252, CW, 268, P.shadow);
  // three buildings behind the wall, each its own kind
  const wallA = [94, 127, 163, 255];
  c.rect(24, 60, 120, 176, wallA);
  c.rect(24, 60, 120, 68, P.ink2);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const wx = 36 + col * 40;
      const wy = 78 + row * 30;
      c.rect(wx, wy, wx + 28, wy + 20, P.ink);
      c.rect(wx + 2, wy + 2, wx + 26, wy + 18, P.glass);
      c.rect(wx + 2, wy + 2, wx + 10, wy + 8, P.glassLit);
    }
  }
  c.outline(24, 60, 120, 177);
  c.rect(150, 40, 234, 176, P.stoneDark);
  for (let y = 44; y < 176; y += 10) {
    for (let x = 150 + ((y / 10) % 2) * 8; x < 234; x += 16) {
      c.rect(x + 1, y, x + 15, y + 8, P.stone);
      c.rect(x + 1, y, x + 15, y + 2, [190, 176, 175, 255]);
    }
  }
  c.rect(146, 30, 238, 40, P.teal);
  c.rect(146, 30, 238, 33, [66, 150, 144, 255]);
  c.outline(146, 30, 238, 41);
  for (const wx of [162, 200]) {
    c.rect(wx, 60, wx + 22, 96, P.ink);
    c.rect(wx + 3, 63, wx + 19, 93, P.glass);
  }
  c.rect(160, 120, 224, 136, P.yellow);
  c.outline(159, 119, 225, 137);
  c.outline(150, 40, 234, 177);
  c.rect(264, 76, 360, 176, P.steelDark);
  for (let x = 266; x < 360; x += 6) c.rect(x, 80, x + 3, 176, P.steel);
  for (let i = 0; i < 16; i++) {
    c.rect(258 + i, 76 - i, 366 - i, 77 - i, i % 4 < 2 ? P.stoneDark : P.steelDark);
  }
  c.rect(288, 120, 336, 176, P.ink);
  c.rect(291, 123, 333, 176, [64, 52, 46, 255]);
  c.outline(264, 76, 360, 177);
  // trees between them
  for (const [tx, ty] of [
    [136, 150],
    [250, 140],
    [372, 160],
    [12, 150],
  ]) {
    c.disc(tx, ty, 14, P.ink);
    c.disc(tx, ty, 12, P.leafDark);
    c.disc(tx - 3, ty - 3, 7, P.leaf);
    c.rect(tx - 2, ty + 10, tx + 2, ty + 24, P.woodDark);
  }
  // a low wall along the front, with a gateway and lamps
  for (const [x0, x1] of [
    [0, 150],
    [234, CW],
  ]) {
    c.rect(x0, 200, x1, 232, P.stone);
    c.rect(x0, 200, x1, 206, P.slabLit);
    c.rect(x0, 226, x1, 232, P.stoneDark);
    c.outline(x0, 199, x1, 233);
  }
  for (const px of [140, 232]) {
    c.rect(px, 184, px + 12, 240, P.stone);
    c.rect(px, 184, px + 12, 188, P.slabLit);
    c.outline(px, 184, px + 12, 241);
    c.rect(px + 2, 174, px + 10, 184, P.yellow);
    c.outline(px + 1, 173, px + 11, 185);
  }
  c.rect(130, 160, 254, 176, P.yellow);
  c.rect(130, 160, 254, 163, P.slabLit);
  c.outline(129, 159, 255, 177);
  c.rect(152, 176, 232, 232, P.slab);
  for (let y = 182; y < 232; y += 12) c.rect(152, y, 232, y + 1, P.grout);
  c.rect(144, 258, 240, 266, P.slab);
  c.rect(144, 258, 240, 260, P.slabLit);
  c.outline(144, 257, 240, 267);
  return c;
}

/** A field crew van, seen from above: white, with the business's stripe, roof rack and mirrors. */
function van() {
  const c = canvas(96, 144);
  c.rect(10, 130, 86, 140, P.shadow);
  // tyres
  for (const [x, y] of [
    [8, 26],
    [8, 106],
    [80, 26],
    [80, 106],
  ])
    c.rect(x, y, x + 8, y + 18, P.ink);
  // body
  c.rect(14, 6, 82, 134, P.ink);
  c.rect(16, 8, 80, 132, [235, 228, 242, 255]);
  c.rect(16, 8, 80, 12, [250, 250, 250, 255]);
  // windscreen and rear window
  c.rect(20, 14, 76, 34, P.ink);
  c.rect(22, 16, 74, 32, P.glass);
  c.rect(22, 16, 40, 22, P.glassLit);
  c.rect(20, 118, 76, 128, P.ink);
  c.rect(22, 120, 74, 126, P.glass);
  // roof: a stripe and a ladder rack
  c.rect(16, 40, 80, 48, P.teal);
  c.rect(16, 40, 80, 42, [66, 150, 144, 255]);
  c.rect(16, 100, 80, 108, P.teal);
  c.rect(16, 100, 80, 102, [66, 150, 144, 255]);
  for (const y of [52, 92]) c.rect(20, y, 76, y + 3, P.steelDark);
  for (const x of [22, 72]) c.rect(x, 52, x + 3, 95, P.steelDark);
  for (let y = 58; y < 92; y += 8) c.rect(25, y, 71, y + 2, P.steel);
  // mirrors and lights
  c.rect(8, 30, 14, 36, P.ink);
  c.rect(82, 30, 88, 36, P.ink);
  c.rect(18, 9, 26, 12, P.yellow);
  c.rect(70, 9, 78, 12, P.yellow);
  c.rect(18, 128, 26, 131, P.red);
  c.rect(70, 128, 78, 131, P.red);
  c.outline(14, 6, 82, 134);
  return c;
}

/** The lab: white walls, a teal dome with a lit lens, an aerial, and a big round window. */
function lab() {
  const c = canvas(W, H);
  c.rect(0, 252, W, 268, P.shadow);
  const white = [235, 228, 242, 255];
  const whiteDark = [204, 194, 216, 255];
  c.rect(30, 110, 258, 258, white);
  for (let y = 116; y < 258; y += 14) c.rect(30, y, 258, y + 1, whiteDark);
  c.rect(30, 110, 258, 116, [250, 250, 250, 255]);
  // the dome
  c.disc(144, 110, 70, P.ink);
  c.disc(144, 110, 68, P.tealDark);
  c.disc(144, 110, 62, P.teal);
  c.disc(126, 92, 22, [66, 150, 144, 255]);
  c.rect(30, 110, 258, 114, P.ink);
  for (let a = -80; a <= 80; a += 20) {
    const x = Math.round(144 + Math.cos(((a - 90) * Math.PI) / 180) * 64);
    const y = Math.round(110 + Math.sin(((a - 90) * Math.PI) / 180) * 64);
    c.rect(x - 1, y, x + 2, y + 6, P.tealDark);
  }
  // the lens at the top, lit
  c.disc(144, 48, 12, P.ink);
  c.disc(144, 48, 10, P.glass);
  c.disc(141, 45, 4, P.glassLit);
  // the aerial
  c.rect(206, 8, 210, 70, P.ink);
  for (const y of [14, 26, 38]) c.rect(196, y, 220, y + 2, P.steel);
  c.disc(208, 6, 3, P.red);
  // the round window
  c.disc(144, 172, 30, P.ink);
  c.disc(144, 172, 27, P.glass);
  c.disc(134, 162, 10, P.glassLit);
  c.rect(142, 145, 146, 199, P.ink);
  c.rect(117, 170, 171, 174, P.ink);
  // side windows, teal-framed
  for (const wx of [52, 208]) {
    c.rect(wx, 140, wx + 28, 176, P.tealDark);
    c.rect(wx + 3, 143, wx + 25, 173, P.glass);
    c.rect(wx + 3, 143, wx + 10, 150, P.glassLit);
  }
  // sign band
  c.rect(78, 150, 210, 168, P.yellow);
  c.rect(78, 150, 210, 153, P.slabLit);
  c.outline(77, 149, 211, 169);
  // the door: a teal airlock
  const dx = (W - 48) / 2;
  c.rect(dx - 8, 208, dx + 56, 258, P.tealDark);
  c.rect(dx - 4, 212, dx + 52, 258, P.ink);
  c.rect(dx, 216, dx + 48, 258, [159, 211, 234, 255]);
  c.rect(dx + 22, 216, dx + 26, 258, P.ink);
  c.rect(dx + 4, 220, dx + 18, 232, P.glassLit);
  c.rect(dx - 12, 258, dx + 60, 266, P.slab);
  c.rect(dx - 12, 258, dx + 60, 260, P.slabLit);
  c.outline(dx - 12, 257, dx + 60, 267);
  // ground-floor vents
  for (const vx of [40, 232]) {
    c.rect(vx, 224, vx + 16, 244, P.steelDark);
    for (let y = 227; y < 244; y += 4) c.rect(vx + 2, y, vx + 14, y + 1, P.steel);
    c.outline(vx, 224, vx + 16, 245);
  }
  c.outline(30, 110, 258, 259);
  return c;
}

// ── Little buildings on a campus: 144px square, sign band blank ──
const S = 144;
function site(draw) {
  const c = canvas(S, S);
  c.rect(0, 126, S, 136, P.shadow);
  draw(c);
  return c;
}
function siteWarehouse() {
  return site((c) => {
    c.rect(12, 44, 132, 128, P.steelDark);
    for (let x = 14; x < 132; x += 6) c.rect(x, 48, x + 3, 128, P.steel);
    for (let i = 0; i < 24; i++) {
      c.rect(6 + i, 44 - i, 138 - i, 45 - i, i % 4 < 2 ? P.stoneDark : P.steelDark);
      c.set(6 + i, 44 - i, P.ink);
      c.set(137 - i, 44 - i, P.ink);
    }
    c.rect(30, 20, 114, 22, P.ink);
    c.rect(48, 78, 96, 128, P.ink);
    c.rect(51, 81, 93, 128, [64, 52, 46, 255]);
    for (let y = 84; y < 128; y += 8) c.rect(51, y, 93, y + 2, P.steelDark);
    c.rect(36, 52, 108, 70, P.yellow);
    c.rect(36, 52, 108, 55, P.slabLit);
    c.outline(35, 51, 109, 71);
    c.rect(40, 128, 104, 134, P.slab);
    c.outline(40, 127, 104, 135);
    c.outline(12, 44, 132, 129);
  });
}
function siteStore() {
  return site((c) => {
    c.rect(12, 34, 132, 128, P.woodLit);
    c.rect(12, 34, 132, 42, P.ink2);
    c.rect(20, 50, 124, 68, P.yellow);
    c.rect(20, 50, 124, 53, P.slabLit);
    c.outline(19, 49, 125, 69);
    for (let x = 16; x < 128; x += 12) {
      c.rect(x, 74, x + 6, 90, P.red);
      c.rect(x + 6, 74, x + 12, 90, P.slabLit);
    }
    c.outline(16, 72, 128, 91);
    c.rect(20, 92, 56, 122, P.ink);
    c.rect(23, 95, 53, 119, P.glass);
    c.rect(23, 95, 36, 104, P.glassLit);
    c.rect(88, 92, 124, 122, P.ink);
    c.rect(91, 95, 121, 119, P.glass);
    c.rect(60, 92, 84, 128, P.ink);
    c.rect(63, 95, 81, 128, [159, 211, 234, 255]);
    c.rect(71, 95, 73, 128, P.ink);
    c.rect(56, 128, 88, 134, P.slab);
    c.outline(56, 127, 88, 135);
    c.outline(12, 34, 132, 129);
  });
}
function siteGarage() {
  return site((c) => {
    c.rect(8, 50, 136, 128, P.stoneDark);
    for (let y = 54; y < 128; y += 10)
      for (let x = 8 + ((y / 10) % 2) * 8; x < 136; x += 16)
        c.rect(x + 1, y, x + 15, y + 8, P.stone);
    c.rect(4, 42, 140, 50, P.steelDark);
    c.rect(4, 42, 140, 44, P.steel);
    c.outline(4, 42, 140, 51);
    for (const gx of [16, 80]) {
      c.rect(gx, 78, gx + 48, 128, P.ink);
      c.rect(gx + 3, 81, gx + 45, 128, P.steel);
      for (let y = 86; y < 128; y += 8) c.rect(gx + 3, y, gx + 45, y + 2, P.steelDark);
    }
    c.rect(40, 54, 104, 72, P.yellow);
    c.rect(40, 54, 104, 57, P.slabLit);
    c.outline(39, 53, 105, 73);
    // a hazard stripe along the base
    for (let x = 8; x < 136; x += 8) c.rect(x, 128, x + 4, 132, P.yellow);
    c.rect(8, 132, 136, 134, P.ink);
    c.outline(8, 50, 136, 129);
  });
}
function siteOffice() {
  return site((c) => {
    const wall = [94, 127, 163, 255];
    c.rect(16, 24, 128, 128, wall);
    c.rect(16, 24, 128, 32, P.ink2);
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 3; col++) {
        const wx = 24 + col * 34,
          wy = 40 + row * 30;
        c.rect(wx, wy, wx + 24, wy + 20, P.ink);
        c.rect(wx + 2, wy + 2, wx + 22, wy + 18, P.glass);
        c.rect(wx + 2, wy + 2, wx + 10, wy + 8, P.glassLit);
      }
    c.rect(28, 100, 116, 118, P.yellow);
    c.rect(28, 100, 116, 103, P.slabLit);
    c.outline(27, 99, 117, 119);
    c.rect(56, 108, 88, 128, P.ink);
    c.rect(59, 111, 85, 128, [159, 211, 234, 255]);
    c.rect(71, 111, 73, 128, P.ink);
    c.rect(52, 128, 92, 134, P.slab);
    c.outline(52, 127, 92, 135);
    c.outline(16, 24, 128, 129);
  });
}

/** Sales: blue glass, a wide window band, a teal roofline. */
function siteOfficeSales() {
  return site((c) => {
    const wall = [94, 127, 163, 255];
    c.rect(16, 28, 128, 128, wall);
    c.rect(12, 20, 132, 30, P.teal);
    c.rect(12, 20, 132, 23, [66, 150, 144, 255]);
    c.outline(12, 20, 132, 31);
    c.rect(22, 38, 122, 62, P.ink);
    c.rect(24, 40, 120, 60, P.glass);
    c.rect(24, 40, 60, 48, P.glassLit);
    for (const x of [56, 88]) c.rect(x, 40, x + 2, 60, P.ink);
    for (let col = 0; col < 3; col++) {
      const wx = 24 + col * 34;
      c.rect(wx, 70, wx + 24, 90, P.ink);
      c.rect(wx + 2, 72, wx + 22, 88, P.glass);
    }
    c.rect(28, 100, 116, 118, P.yellow);
    c.rect(28, 100, 116, 103, P.slabLit);
    c.outline(27, 99, 117, 119);
    c.rect(56, 108, 88, 128, P.ink);
    c.rect(59, 111, 85, 128, [159, 211, 234, 255]);
    c.rect(71, 111, 73, 128, P.ink);
    c.rect(52, 128, 92, 134, P.slab);
    c.outline(52, 127, 92, 135);
    c.outline(16, 28, 128, 129);
  });
}
/** Finance: a sandstone bank with columns and a pediment. */
function siteOfficeFinance() {
  return site((c) => {
    const sand = [219, 202, 169, 255];
    const sandDark = [192, 158, 128, 255];
    c.rect(14, 44, 130, 128, sand);
    for (let y = 48; y < 128; y += 10) c.rect(14, y, 130, y + 1, sandDark);
    for (let i = 0; i < 18; i++) c.rect(22 + i * 3, 44 - i, 122 - i * 3, 45 - i, sand);
    for (let i = 0; i < 18; i++) {
      c.set(22 + i * 3, 44 - i, P.ink);
      c.set(23 + i * 3, 44 - i, P.ink);
      c.set(121 - i * 3, 44 - i, P.ink);
      c.set(122 - i * 3, 44 - i, P.ink);
    }
    c.rect(22, 44, 122, 46, P.ink);
    for (const cx of [24, 46, 90, 112]) {
      c.rect(cx, 52, cx + 8, 128, [235, 228, 210, 255]);
      c.rect(cx + 6, 52, cx + 8, 128, sandDark);
      c.outline(cx, 52, cx + 8, 129);
      c.rect(cx - 2, 50, cx + 10, 54, sandDark);
    }
    c.rect(56, 92, 88, 110, P.yellow);
    c.rect(56, 92, 88, 95, P.slabLit);
    c.outline(55, 91, 89, 111);
    c.rect(58, 60, 86, 84, P.ink);
    c.rect(61, 63, 83, 81, P.glass);
    c.rect(60, 112, 84, 128, P.ink);
    c.rect(63, 115, 81, 128, [64, 52, 46, 255]);
    c.rect(71, 115, 73, 128, P.ink);
    c.rect(48, 128, 96, 134, P.slab);
    c.outline(48, 127, 96, 135);
    c.outline(14, 44, 130, 129);
  });
}
/** Operations: a steel-clad block with a red band and a rooftop unit. */
function siteOfficeOperations() {
  return site((c) => {
    c.rect(14, 36, 130, 128, P.steelDark);
    for (let x = 16; x < 130; x += 6) c.rect(x, 40, x + 3, 128, P.steel);
    c.rect(14, 36, 130, 40, P.ink2);
    c.rect(96, 26, 122, 36, P.stoneDark);
    c.outline(96, 26, 122, 37);
    c.rect(100, 20, 104, 26, P.ink2);
    c.rect(14, 62, 130, 72, P.red);
    c.rect(14, 62, 130, 64, [210, 120, 90, 255]);
    for (const wy of [44, 78]) {
      for (let col = 0; col < 3; col++) {
        const wx = 24 + col * 34;
        c.rect(wx, wy, wx + 24, wy + 14, P.ink);
        c.rect(wx + 2, wy + 2, wx + 22, wy + 12, P.glass);
      }
    }
    c.rect(28, 96, 116, 112, P.yellow);
    c.rect(28, 96, 116, 99, P.slabLit);
    c.outline(27, 95, 117, 113);
    c.rect(56, 108, 88, 128, P.ink);
    c.rect(59, 111, 85, 128, [159, 211, 234, 255]);
    c.rect(71, 111, 73, 128, P.ink);
    c.rect(52, 128, 92, 134, P.slab);
    c.outline(52, 127, 92, 135);
    c.outline(14, 36, 130, 129);
  });
}

/** The same picture at twice the size, each pixel doubled: still pixel art. */
function doubled(c) {
  const out = canvas(c.w * 2, c.h * 2);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const i = (y * c.w + x) * 4;
      const px = [c.px[i], c.px[i + 1], c.px[i + 2], c.px[i + 3]];
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          out.px.set(px, ((y * 2 + dy) * out.w + x * 2 + dx) * 4);
        }
      }
    }
  }
  return out;
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
save("building_supply.png", supply());
save("building_blocks.png", blocks());
save("building_campus.png", campus());
save("site_warehouse.png", siteWarehouse());
save("site_store.png", siteStore());
save("site_garage.png", siteGarage());
save("site_office.png", siteOffice());
save("site_office_sales.png", siteOfficeSales());
save("site_office_finance.png", siteOfficeFinance());
save("site_office_operations.png", siteOfficeOperations());
save("van_96x144.png", van());
save("asphalt_48.png", asphalt());
save("pond_288x192.png", pond());
save("site_office_sales_2x.png", doubled(siteOfficeSales()));
save("site_office_finance_2x.png", doubled(siteOfficeFinance()));
save("site_office_operations_2x.png", doubled(siteOfficeOperations()));
save("site_store_2x.png", doubled(siteStore()));
save("site_garage_2x.png", doubled(siteGarage()));
save("site_warehouse_2x.png", doubled(siteWarehouse()));
save("building_lab.png", lab());
