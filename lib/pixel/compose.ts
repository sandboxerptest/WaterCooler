/**
 * Lays cut-out poses into the game's sheet.
 *
 * The game reads a fixed grid: row 1 is idle, row 2 is walk, each holding
 * right / up / left / down at six frames apiece. A loose sheet almost never
 * supplies exactly that — it might have one side view, two walk frames, or no
 * back at all — so the job here is to fill every slot the game will look in,
 * from whatever poses exist, without leaving a hole.
 */

import type { Bitmap } from "./png";
import { blankSheet, blitFrame } from "./ingest";

export const FRAME_W = 48;
export const FRAME_H = 96;
export const COLUMNS = 56;
export const FRAMES_PER_DIRECTION = 6;
export const SHEET_W = COLUMNS * FRAME_W;
export const SHEET_H = 1968;

export const FACINGS = ["right", "up", "left", "down"] as const;
export type Facing = (typeof FACINGS)[number];
export const KINDS = ["idle", "walk"] as const;
export type Kind = (typeof KINDS)[number];

const ROW: Record<Kind, number> = { idle: 1, walk: 2 };

export interface Assignment {
  /** Index into the frames array. */
  pose: number;
  facing: Facing;
  kind: Kind;
}

/** Mirrors a frame left-to-right. */
export function flipHorizontal(frame: Bitmap): Bitmap {
  const { width, height } = frame;
  const data = new Uint8Array(frame.data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = (y * width + (width - 1 - x)) * 4;
      data[d] = frame.data[s];
      data[d + 1] = frame.data[s + 1];
      data[d + 2] = frame.data[s + 2];
      data[d + 3] = frame.data[s + 3];
    }
  }
  return { width, height, data };
}

const MIRROR: Partial<Record<Facing, Facing>> = { left: "right", right: "left" };

/**
 * The frames to show for one facing and kind, six of them.
 *
 * Resolution order, each step only when the one before found nothing:
 *   1. poses drawn for exactly this facing and kind
 *   2. the opposite side, mirrored — most sheets draw one profile
 *   3. the same facing's other kind — a walk with no frames stands still
 *   4. the mirrored opposite side's other kind
 *   5. facing down, which every sheet has
 *
 * Fewer than six frames cycle to fill the row; a two-frame walk becomes
 * A B A B A B, which reads as a step rather than a freeze.
 */
export function framesFor(
  frames: Bitmap[],
  assignments: Assignment[],
  facing: Facing,
  kind: Kind,
): Bitmap[] {
  const pick = (f: Facing, k: Kind) =>
    assignments.filter((a) => a.facing === f && a.kind === k).map((a) => frames[a.pose]);
  const otherKind: Kind = kind === "idle" ? "walk" : "idle";
  const mirror = MIRROR[facing];

  let found = pick(facing, kind);
  if (!found.length && mirror) found = pick(mirror, kind).map(flipHorizontal);
  if (!found.length) found = pick(facing, otherKind);
  if (!found.length && mirror) found = pick(mirror, otherKind).map(flipHorizontal);
  if (!found.length && facing !== "down") found = framesFor(frames, assignments, "down", kind);
  if (!found.length) found = frames.length ? [frames[0]] : [];
  if (!found.length) return [];

  return Array.from({ length: FRAMES_PER_DIRECTION }, (_, i) => found[i % found.length]);
}

/**
 * Builds the full sheet.
 *
 * Rows 1 and 2 are what the game animates from. The first idle-down frame is
 * also copied to row 0, column 0, so a sheet opened in an image viewer leads
 * with the character's face rather than a blank strip.
 */
export function composeSheet(frames: Bitmap[], assignments: Assignment[]): Bitmap {
  const sheet = blankSheet(SHEET_W, SHEET_H);

  for (const kind of KINDS) {
    FACINGS.forEach((facing, direction) => {
      const run = framesFor(frames, assignments, facing, kind);
      run.forEach((frame, i) => {
        blitFrame(sheet, frame, direction * FRAMES_PER_DIRECTION + i, ROW[kind]);
      });
    });
  }

  const face = framesFor(frames, assignments, "down", "idle")[0];
  if (face) blitFrame(sheet, face, 0, 0);

  return sheet;
}

/** Drops assignments that point outside the frames array or repeat a pose. */
export function sanitiseAssignments(raw: unknown, frameCount: number): Assignment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: Assignment[] = [];
  for (const item of raw) {
    const a = item as Partial<Assignment>;
    if (typeof a.pose !== "number" || !Number.isInteger(a.pose)) continue;
    if (a.pose < 0 || a.pose >= frameCount || seen.has(a.pose)) continue;
    if (!FACINGS.includes(a.facing as Facing) || !KINDS.includes(a.kind as Kind)) continue;
    seen.add(a.pose);
    out.push({ pose: a.pose, facing: a.facing as Facing, kind: a.kind as Kind });
  }
  return out;
}

/**
 * Corrects a lone facing that disagrees with the rest of its row.
 *
 * A drawn sheet puts one direction per row — that is how every sheet
 * generator and every artist lays one out — so a single figure labelled
 * differently from its neighbours is far more likely a misread than a real
 * exception. Left uncorrected, a wrong facing inside a six-frame cycle shows
 * as a flicker to the side every sixth frame.
 *
 * Only facing is reconciled. Kind legitimately varies within a row: a row of
 * front views can hold a stand, a wave and a run.
 *
 * The vote needs a clear majority in a row of at least `minRow`, so a genuine
 * two-facing row is left alone rather than flattened.
 */
export function reconcileRows(
  assignments: Assignment[],
  rowOf: (pose: number) => number,
  minRow = 3,
  threshold = 0.6,
): { assignments: Assignment[]; corrected: number[] } {
  const byRow = new Map<number, Assignment[]>();
  for (const a of assignments) {
    const row = rowOf(a.pose);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row)!.push(a);
  }

  const corrected: number[] = [];
  const out = assignments.map((a) => ({ ...a }));

  for (const members of byRow.values()) {
    if (members.length < minRow) continue;
    const tally = new Map<Facing, number>();
    for (const m of members) tally.set(m.facing, (tally.get(m.facing) ?? 0) + 1);
    const [majority, count] = [...tally.entries()].sort((x, y) => y[1] - x[1])[0];
    if (count / members.length < threshold) continue;

    for (const m of members) {
      if (m.facing === majority) continue;
      const target = out.find((o) => o.pose === m.pose)!;
      target.facing = majority;
      corrected.push(m.pose);
    }
  }

  return { assignments: out, corrected };
}

/** The slot the HUD shows as a character's face: first idle frame, facing down. */
export const PORTRAIT_COLUMN = 18;
export const PORTRAIT_ROW = 1;

/**
 * Copies one slot out of a sheet.
 *
 * The inverse of blitFrame. The HUD used to show a portrait by setting a
 * whole 2688x1968 sheet as a CSS background and offsetting it — which means
 * every card in a gallery decodes a 21-megapixel image to display 48x96
 * pixels of it. Cutting the frame out once, server-side, is the fix.
 */
export function sliceFrame(sheet: Bitmap, column: number, row: number): Bitmap {
  const out = new Uint8Array(FRAME_W * FRAME_H * 4);
  const x0 = column * FRAME_W;
  const y0 = row * FRAME_H;
  for (let y = 0; y < FRAME_H; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= sheet.height) continue;
    const s = (sy * sheet.width + x0) * 4;
    out.set(sheet.data.subarray(s, s + FRAME_W * 4), y * FRAME_W * 4);
  }
  return { width: FRAME_W, height: FRAME_H, data: out };
}
