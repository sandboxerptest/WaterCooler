/**
 * Colour maths for re-skinning a character.
 *
 * Recolouring pixel art is not a hue swap. Every material on a LimeZu
 * character is a small ramp — a highlight, a body tone and a shadow — and it
 * is the *spacing* of that ramp that makes the sprite read as rounded rather
 * than flat. So a new colour is applied by keeping the artist's lightness
 * steps and substituting only the hue and saturation.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function parseHex(hex: string): Rgb {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Not a colour: "${hex}"`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return {
    r: Math.round(channel(h + 1 / 3) * 255),
    g: Math.round(channel(h) * 255),
    b: Math.round(channel(h - 1 / 3) * 255),
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Rebuilds a ramp around a new colour.
 *
 * The base ramp's own mid tone is the anchor: every entry keeps its lightness
 * distance from that anchor, so a three-step ramp stays a three-step ramp and
 * the shading survives. Saturation is nudged the same way, which stops a
 * vivid target from flattening its own shadow into the same colour.
 *
 * Returned in the same order as `base`, so callers can zip the two together.
 */
export function remapRamp(base: Rgb[], target: Rgb): Rgb[] {
  if (base.length === 0) return [];
  const baseHsl = base.map(rgbToHsl);
  const anchor = baseHsl[Math.floor(baseHsl.length / 2)];
  const t = rgbToHsl(target);

  return baseHsl.map((c) => {
    const dl = c.l - anchor.l;
    const ds = c.s - anchor.s;
    return hslToRgb({
      h: t.h,
      s: clamp01(t.s + ds),
      // A very light or very dark target has no room for its own ramp, so the
      // step is compressed toward the end of the range rather than clipped —
      // otherwise every shade collapses into one and the sprite goes flat.
      l: clamp01(t.l + dl * (dl > 0 ? 1 - t.l : t.l) * 2),
    });
  });
}

/** Key for a colour lookup table. Alpha is deliberately not part of it. */
export function colourKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}
