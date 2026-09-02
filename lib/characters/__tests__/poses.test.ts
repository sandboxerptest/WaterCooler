import { describe, it, expect, afterEach, vi } from "vitest";
import { describeLayout, readSheet, setPosesClient } from "../poses";
import type { DetectedPose } from "../../pixel/ingest";

const pose = (row: number, column: number, x: number, y: number): DetectedPose => ({
  row,
  column,
  box: { x, y, width: 100, height: 200 },
  toFrame: () => ({ width: 48, height: 96, data: new Uint8Array(48 * 96 * 4) }),
});

const poses = [pose(0, 0, 10, 10), pose(0, 1, 300, 12), pose(1, 0, 15, 400)];

describe("describeLayout", () => {
  it("numbers figures in reading order and says where they are", () => {
    const text = describeLayout(poses, 800, 700);
    expect(text).toContain("3 figures in 2 rows");
    expect(text).toContain("figure 0: row 0, column 0, centred at (60, 110)");
    expect(text).toContain("figure 2: row 1, column 0");
  });
});

describe("readSheet", () => {
  afterEach(() => setPosesClient(null));

  const stub = (text: string, stopReason = "end_turn") => ({
    create: vi.fn(async () => ({ stop_reason: stopReason, content: [{ type: "text", text }] })),
  });

  it("returns the model's assignments, cleaned", async () => {
    setPosesClient(
      stub(
        JSON.stringify({
          name: "Yoshi",
          notes: "Green dinosaur in a red kimono.",
          poses: [
            { pose: 0, facing: "down", kind: "idle" },
            { pose: 1, facing: "down", kind: "walk" },
            { pose: 2, facing: "up", kind: "idle" },
            { pose: 7, facing: "left", kind: "idle" }, // no such figure
          ],
        }),
      ) as never,
    );
    const out = await readSheet(Buffer.from("png"), poses, 800, 700);
    expect(out.name).toBe("Yoshi");
    expect(out.assignments).toHaveLength(3);
    expect(out.assignments.map((a) => a.pose)).toEqual([0, 1, 2]);
  });

  it("fails clearly when nothing could be assigned", async () => {
    setPosesClient(stub(JSON.stringify({ name: "x", notes: "", poses: [] })) as never);
    await expect(readSheet(Buffer.from("png"), poses, 800, 700)).rejects.toThrow(
      /could not match/i,
    );
  });

  it("reports a refusal as something a person can act on", async () => {
    setPosesClient(stub("", "refusal") as never);
    await expect(readSheet(Buffer.from("png"), poses, 800, 700)).rejects.toThrow(/different one/i);
  });
});
