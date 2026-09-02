import { describe, expect, it } from "vitest";
import {
  GARAGE_BAYS,
  HEIGHT,
  STORE_DOORS,
  WIDTH,
  buildGarageSpec,
  buildStoreSpec,
  buildWarehouseSpec,
} from "../premises";
import { deriveCollisions, generateMap, paintShell, wallCollisions } from "../generate";
import { STANDABLE } from "../office";
import { allReachable } from "../../world/scenery";

const store = buildStoreSpec({
  self: "blockhouse-store",
  warehouse: "blockhouse-warehouse",
  fieldCrew: "blockhouse-field-crew",
});
const plainStore = buildStoreSpec({ self: "homestar-store" });
const warehouse = buildWarehouseSpec("blockhouse-store");
const garage = buildGarageSpec("blockhouse-store");

const bounds = { width: WIDTH * 48, height: HEIGHT * 48 };

function solids(spec: ReturnType<typeof buildStoreSpec>) {
  return [...wallCollisions(spec), ...deriveCollisions(spec)];
}

describe("the premises", () => {
  for (const [name, spec] of [
    ["store", store],
    ["warehouse", warehouse],
    ["garage", garage],
  ] as const) {
    describe(name, () => {
      it("generates every layer the scene reads, with furniture on the floor", () => {
        const map = generateMap(spec, []);
        for (const layer of ["floor", "walls", "ground", "furniture", "objects", "overhead"]) {
          expect(map.layers.find((l) => l.name === layer)?.type).toBe("tilelayer");
        }
        const shell = paintShell(spec);
        for (const p of spec.placements.filter((pl) => pl.layer !== "walls")) {
          expect(STANDABLE, `${name} furniture at ${p.tx},${p.ty} off the floor`).toContain(
            shell[p.ty * WIDTH + p.tx],
          );
        }
      });

      it("has every door in the top wall and reachable from the spawn", () => {
        const spawn = spec.spawns[0];
        const from = { x: spawn.tx * 48 + 24, y: spawn.ty * 48 + 24 };
        const doors = spec.transitions.map((t) => ({ x: t.tx * 48 + 24, y: 3 * 48 + 24 }));
        for (const t of spec.transitions) expect(t.ty).toBe(0);
        expect(allReachable(bounds, solids(spec), from, doors)).toBe(true);
      });

      it("has no lift", () => {
        expect(spec.transitions.some((t) => t.name === "elevator")).toBe(false);
      });
    });
  }

  it("gives a store the doors its business has, the warehouse's nearest the front", () => {
    expect(store.transitions.map((t) => t.name)).toEqual(["door", "warehouse", "field-crew"]);
    const col = (name: string) => store.transitions.find((t) => t.name === name)!.tx;
    expect(col("warehouse") - col("door")).toBeLessThanOrEqual(3);
    expect(col("field-crew")).toBeGreaterThan(col("warehouse"));
    expect(store.transitions.find((t) => t.name === "warehouse")!.target).toBe(
      "room:blockhouse-warehouse:store",
    );
    expect(plainStore.transitions.map((t) => t.name)).toEqual(["door"]);
    expect(STORE_DOORS.front).toBeLessThan(STORE_DOORS.warehouse);
  });

  it("leads back from the warehouse and the garage to the store's matching door", () => {
    expect(warehouse.transitions[0].target).toBe("room:blockhouse-store:warehouse");
    expect(garage.transitions[0].target).toBe("room:blockhouse-store:field-crew");
  });

  it("keeps the garage's bays clear of the furniture", () => {
    for (const bay of GARAGE_BAYS) {
      const box = { x: bay.x, y: bay.y, width: 96, height: 144 };
      for (const s of solids(garage)) {
        const apart =
          box.x + box.width <= s.x ||
          s.x + s.width <= box.x ||
          box.y + box.height <= s.y ||
          s.y + s.height <= box.y;
        expect(apart).toBe(true);
      }
    }
  });
});
