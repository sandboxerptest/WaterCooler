import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { decodePng } from "../png";
import { blankSheet } from "../ingest";
import { composeSheet, FRAME_H, FRAME_W, SHEET_H, SHEET_W } from "../compose";
import { emptySlots, isExactSheet, normaliseExactSheet, slotName } from "../exact";

const library = decodePng(
  readFileSync(join(process.cwd(), "public/characters/Premade_Character_48x48_09.png")),
);

describe("isExactSheet", () => {
  it("accepts a library sheet", () => {
    expect(isExactSheet(library)).toBe(true);
  });

  it("accepts a minimal three-row sheet", () => {
    expect(isExactSheet(blankSheet(SHEET_W, FRAME_H * 3))).toBe(true);
  });

  it("rejects any other width, however close", () => {
    // 56 columns is hard-coded; a wrong width animates from the wrong pixels.
    expect(isExactSheet(blankSheet(SHEET_W - 48, SHEET_H))).toBe(false);
    expect(isExactSheet(blankSheet(1536, 1024))).toBe(false);
  });

  it("rejects a sheet too short to hold the three rows the game reads", () => {
    expect(isExactSheet(blankSheet(SHEET_W, FRAME_H * 2))).toBe(false);
  });

  it("does not insist on whole rows — the library's own height ends on a half row", () => {
    expect(SHEET_H % FRAME_H).not.toBe(0);
    expect(isExactSheet(blankSheet(SHEET_W, FRAME_H * 3 + 10))).toBe(true);
  });
});

describe("normaliseExactSheet", () => {
  it("leaves a transparent library sheet exactly alone", () => {
    const { sheet, backdropRemoved, padded } = normaliseExactSheet(library);
    expect(backdropRemoved).toBe(false);
    expect(padded).toBe(false);
    expect(sheet.data).toBe(library.data);
  });

  it("pads a short sheet to the library height with clear rows", () => {
    const short = blankSheet(SHEET_W, FRAME_H * 3);
    short.data.set([200, 10, 10, 255], (100 * SHEET_W + 900) * 4);
    const { sheet, padded } = normaliseExactSheet(short);
    expect(padded).toBe(true);
    expect(sheet.height).toBe(SHEET_H);
    expect(sheet.data[(100 * SHEET_W + 900) * 4]).toBe(200);
    expect(sheet.data[(SHEET_H - 1) * SHEET_W * 4 + 3]).toBe(0);
  });

  it("clears a flat black backdrop that was left in", () => {
    const onBlack = blankSheet(SHEET_W, SHEET_H);
    for (let i = 0; i < onBlack.data.length; i += 4) onBlack.data.set([0, 0, 0, 255], i);
    onBlack.data.set([220, 120, 60, 255], (150 * SHEET_W + 900) * 4);
    const { sheet, backdropRemoved } = normaliseExactSheet(onBlack);
    expect(backdropRemoved).toBe(true);
    expect(sheet.data[3]).toBe(0);
    expect(sheet.data[(150 * SHEET_W + 900) * 4 + 3]).toBe(255);
  });
});

describe("emptySlots", () => {
  it("finds nothing missing on a library sheet", () => {
    expect(emptySlots(library)).toEqual([]);
  });

  it("names every empty animated slot on a blank sheet", () => {
    const empty = emptySlots(blankSheet(SHEET_W, SHEET_H));
    expect(empty).toHaveLength(48);
    expect(empty[0]).toBe("idle right #1");
    expect(empty[23]).toBe("idle down #6");
    expect(empty[47]).toBe("walk down #6");
  });

  it("names exactly the slot a composed sheet left empty", () => {
    // A composed sheet fills every slot; blank one on purpose.
    const face = { width: FRAME_W, height: FRAME_H, data: new Uint8Array(FRAME_W * FRAME_H * 4) };
    for (let i = 3; i < face.data.length; i += 4) face.data[i] = 255;
    const sheet = composeSheet([face], [{ pose: 0, facing: "down", kind: "idle" }]);
    const col = 6 + 2; // idle up #3
    for (let y = 0; y < FRAME_H; y++) {
      sheet.data.fill(
        0,
        ((FRAME_H + y) * SHEET_W + col * FRAME_W) * 4,
        ((FRAME_H + y) * SHEET_W + (col + 1) * FRAME_W) * 4,
      );
    }
    expect(emptySlots(sheet)).toEqual(["idle up #3"]);
  });

  it("ignores the rows the game never reads", () => {
    const sheet = blankSheet(SHEET_W, SHEET_H);
    for (const row of [1, 2]) {
      for (let y = 0; y < FRAME_H; y++) {
        const start = (row * FRAME_H + y) * SHEET_W * 4;
        for (let x = 0; x < 24 * FRAME_W; x++) sheet.data[start + x * 4 + 3] = 255;
      }
    }
    expect(emptySlots(sheet)).toEqual([]);
  });
});

describe("slotName", () => {
  it("reads the way the layout is documented", () => {
    expect(slotName(1, 0)).toBe("idle right #1");
    expect(slotName(2, 17)).toBe("walk left #6");
  });
});
