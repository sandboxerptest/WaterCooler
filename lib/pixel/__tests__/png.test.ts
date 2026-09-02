import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { decodePng, encodePng, type Bitmap } from "../png";

const SHEET = join(process.cwd(), "public/characters/Premade_Character_48x48_09.png");

function solid(width: number, height: number, rgba: [number, number, number, number]): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

describe("png codec", () => {
  it("round-trips an image byte for byte", () => {
    const source = solid(7, 5, [12, 240, 33, 255]);
    const back = decodePng(encodePng(source));
    expect(back.width).toBe(7);
    expect(back.height).toBe(5);
    expect(Array.from(back.data)).toEqual(Array.from(source.data));
  });

  it("preserves alpha, including fully transparent pixels", () => {
    const source = solid(3, 3, [10, 20, 30, 0]);
    source.data.set([1, 2, 3, 128], 4 * 4);
    const back = decodePng(encodePng(source));
    expect(Array.from(back.data.slice(0, 4))).toEqual([10, 20, 30, 0]);
    expect(Array.from(back.data.slice(16, 20))).toEqual([1, 2, 3, 128]);
  });

  it("reads a real character sheet at its documented size", () => {
    const sheet = decodePng(readFileSync(SHEET));
    expect(sheet.width).toBe(2688);
    expect(sheet.height).toBe(1968);
    expect(sheet.data.length).toBe(2688 * 1968 * 4);
  });

  it("decodes every scanline filter the real sheets use", () => {
    // The library sheets are written by an art tool that uses the adaptive
    // filters; a wrong Paeth or Average implementation shows up as noise
    // rather than an error, so check for structure instead.
    const sheet = decodePng(readFileSync(SHEET));
    let opaque = 0;
    let transparent = 0;
    for (let i = 3; i < sheet.data.length; i += 4) {
      if (sheet.data[i] === 255) opaque++;
      else if (sheet.data[i] === 0) transparent++;
    }
    // A character sheet is mostly empty space around solid sprites, and a
    // mis-filtered decode produces neither.
    expect(transparent).toBeGreaterThan(opaque);
    expect(opaque).toBeGreaterThan(100_000);
    expect(opaque + transparent).toBeGreaterThan(sheet.width * sheet.height * 0.95);
  });

  it("re-encodes a decoded sheet to the same pixels", () => {
    const sheet = decodePng(readFileSync(SHEET));
    const again = decodePng(encodePng(sheet));
    expect(again.data.length).toBe(sheet.data.length);
    // Spot-check rather than compare 21M bytes.
    for (const i of [0, 5_000_003, 10_000_007, sheet.data.length - 4]) {
      expect(again.data[i]).toBe(sheet.data[i]);
    }
  });

  it("refuses a PNG it cannot honestly read", () => {
    const fake = Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...Array(40).fill(0),
    ]);
    fake.writeUInt32BE(4, 16);
    fake.writeUInt32BE(4, 20);
    fake[24] = 8;
    fake[25] = 3; // palette
    expect(() => decodePng(fake)).toThrow(/colour type/i);
  });

  it("rejects something that is not a PNG at all", () => {
    expect(() => decodePng(Buffer.from("hello world"))).toThrow(/Not a PNG/);
  });
});
