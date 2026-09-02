import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { decodePng, encodePng } from "../png";
import {
  BASE_RAMPS,
  BASE_SHEET,
  buildColourMap,
  recolourSheet,
  renderCharacterSheet,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  type CharacterColours,
} from "../character";
import { colourKey, parseHex, remapRamp, rgbToHsl, toHex } from "../palette";

const baseFile = readFileSync(join(process.cwd(), "public/characters", BASE_SHEET));

const GINGER: CharacterColours = {
  hair: "#c2571f",
  skin: "#f6d3b0",
  outfit: "#2e7d4f",
  shoes: "#5b3a29",
};

describe("colour ramps", () => {
  it("keeps a ramp's shading order after remapping", () => {
    const base = BASE_RAMPS.hair.map(parseHex);
    const out = remapRamp(base, parseHex("#c2571f"));
    const lightness = out.map((c) => rgbToHsl(c).l);
    // Light to dark going in, light to dark coming out.
    expect(lightness[0]).toBeGreaterThan(lightness[1]);
    expect(lightness[1]).toBeGreaterThan(lightness[2]);
  });

  it("takes the target's hue", () => {
    const out = remapRamp(BASE_RAMPS.hair.map(parseHex), parseHex("#c2571f"));
    const wanted = rgbToHsl(parseHex("#c2571f")).h;
    // Two places, not five: the ramp is rounded to 8-bit channels on the way
    // out, which moves the hue very slightly.
    for (const c of out) expect(rgbToHsl(c).h).toBeCloseTo(wanted, 2);
  });

  it("keeps a ramp distinct even at the extremes of lightness", () => {
    // Near-black and near-white targets have no headroom; a naive shift
    // collapses every shade into one and the sprite goes flat.
    for (const target of ["#050505", "#fafafa"]) {
      const out = remapRamp(BASE_RAMPS.hair.map(parseHex), parseHex(target));
      const unique = new Set(out.map(toHex));
      expect(unique.size, `${target} produced ${[...unique].join(",")}`).toBeGreaterThan(1);
    }
  });

  it("round-trips hex", () => {
    expect(toHex(parseHex("#c2571f"))).toBe("#c2571f");
    expect(toHex(parseHex("abc"))).toBe("#aabbcc");
  });

  it("rejects something that is not a colour", () => {
    expect(() => parseHex("chartreuse")).toThrow(/Not a colour/);
    expect(() => parseHex("#12345")).toThrow(/Not a colour/);
  });
});

describe("colour map", () => {
  const map = buildColourMap(GINGER);

  it("covers every colour in every ramp", () => {
    const expected = Object.values(BASE_RAMPS).flat().length;
    expect(map.size).toBe(expected);
    for (const hex of Object.values(BASE_RAMPS).flat()) {
      const c = parseHex(hex);
      expect(map.has(colourKey(c.r, c.g, c.b))).toBe(true);
    }
  });

  it("leaves the outline alone", () => {
    // The outline traces hair, face, arms and boots alike, so tinting it with
    // any one material would smear that hue around the whole character.
    for (const outline of ["#46465e", "#3a3a50"]) {
      const c = parseHex(outline);
      expect(map.has(colourKey(c.r, c.g, c.b))).toBe(false);
    }
  });
});

describe("rendering a sheet", () => {
  const png = renderCharacterSheet(baseFile, GINGER);
  const out = decodePng(png);
  const base = decodePng(baseFile);

  it("keeps the exact dimensions the animation config assumes", () => {
    expect(out.width).toBe(SHEET_WIDTH);
    expect(out.height).toBe(SHEET_HEIGHT);
  });

  it("moves no pixel — only recolours them", () => {
    // Alpha is the silhouette. If a single alpha byte differs, the geometry
    // has shifted and the sheet no longer lines up with the others.
    let alphaDiffs = 0;
    for (let i = 3; i < out.data.length; i += 4) {
      if (out.data[i] !== base.data[i]) alphaDiffs++;
    }
    expect(alphaDiffs).toBe(0);
  });

  it("actually changes the character", () => {
    let changed = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (
        out.data[i] !== base.data[i] ||
        out.data[i + 1] !== base.data[i + 1] ||
        out.data[i + 2] !== base.data[i + 2]
      )
        changed++;
    }
    expect(changed).toBeGreaterThan(10_000);
  });

  it("leaves transparent pixels fully transparent", () => {
    // Writing colour into clear pixels leaves a halo as soon as anything
    // scales the sheet. Counted rather than asserted per pixel: there are
    // 5.3 million of them and an expect() each takes minutes.
    let leaked = 0;
    for (let i = 3; i < out.data.length; i += 4) {
      if (base.data[i] === 0 && out.data[i] !== 0) leaked++;
    }
    expect(leaked).toBe(0);
  });

  it("introduces no colour the ramps did not ask for", () => {
    const allowed = new Set<number>();
    for (const [, to] of buildColourMap(GINGER)) allowed.add(colourKey(to.r, to.g, to.b));
    const baseColours = new Set<number>();
    for (let i = 0; i < base.data.length; i += 4) {
      if (base.data[i + 3] === 0) continue;
      baseColours.add(colourKey(base.data[i], base.data[i + 1], base.data[i + 2]));
    }
    const strays = new Set<number>();
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] === 0) continue;
      const k = colourKey(out.data[i], out.data[i + 1], out.data[i + 2]);
      if (!allowed.has(k) && !baseColours.has(k)) strays.add(k);
    }
    expect([...strays].map((k) => k.toString(16))).toEqual([]);
  });

  it("refuses a base sheet of the wrong size", () => {
    // The frame grid is hard-coded, so a wrong-sized sheet animates from the
    // wrong pixels rather than failing outright — exactly the bug that had
    // Alice and Bob rendering from 1536x1024 uploads.
    const cropped = { width: 100, height: 100, data: new Uint8Array(100 * 100 * 4) };
    expect(() => renderCharacterSheet(encodePng(cropped), GINGER)).toThrow(/2688x1968/);
  });
});

describe("recolourSheet", () => {
  it("does not mutate the sheet it was given", () => {
    const sheet = decodePng(baseFile);
    const before = sheet.data[0];
    recolourSheet(sheet, buildColourMap(GINGER));
    expect(sheet.data[0]).toBe(before);
  });
});
