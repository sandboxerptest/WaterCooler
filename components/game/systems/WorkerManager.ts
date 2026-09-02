import * as Phaser from "phaser";
import { Worker, type POI } from "../entities/Worker";
import type { Direction } from "../config/animations";
import type { Pathfinder } from "../utils/Pathfinder";
import type { SeatDef } from "../utils/MapHelpers";
import type { SeatState } from "@/types/game";
import { ensureSheet } from "../utils/sheets";
import { createLogger } from "@/lib/logger";

const log = createLogger("Workers");

export class WorkerManager {
  private scene: Phaser.Scene;
  private pois: POI[];
  private pathfinder: Pathfinder;

  workers: Worker[] = [];
  runWorkerMap = new Map<string, Worker>();
  seatDefs: SeatDef[] = [];
  /** Sheets being fetched, so a seat is not requested twice while it loads. */
  private pending = new Set<string>();
  /** The last sync, replayed once a sheet arrives. */
  private lastSync: { seats: SeatState[]; clearNearest: (worker: Worker) => void } | null = null;

  constructor(scene: Phaser.Scene, seatDefs: SeatDef[], pois: POI[], pathfinder: Pathfinder) {
    this.scene = scene;
    this.seatDefs = seatDefs;
    this.pois = pois;
    this.pathfinder = pathfinder;
  }

  spawnWorker(seatDef: SeatDef, seat: SeatState): Worker | null {
    if (!seat.spriteKey) return null;
    // A look chosen from the roster may not be a texture yet. Fetch it, and
    // come back to this seat when it is — the worker appears a moment late
    // rather than as a blank.
    if (!this.scene.textures.exists(seat.spriteKey)) {
      if (seat.spritePath && !this.pending.has(seat.spriteKey)) {
        this.pending.add(seat.spriteKey);
        const key = seat.spriteKey;
        log.info(`fetching sheet ${key} for seat ${seat.seatId}`);
        ensureSheet(this.scene, key, seat.spritePath, (ok) => {
          this.pending.delete(key);
          if (!ok) log.error(`sheet ${key} failed to load for seat ${seat.seatId}`);
          else log.info(`sheet ${key} ready; placing seat ${seat.seatId}`);
          if (ok && this.lastSync)
            this.syncWorkers(this.lastSync.seats, this.lastSync.clearNearest);
        });
      }
      return null;
    }
    const initialFacing: Direction = seatDef.facing;
    const worker = new Worker(
      this.scene,
      seatDef.x,
      seatDef.y,
      seat.spriteKey,
      seatDef.seatId,
      seat.label,
      initialFacing,
    );
    worker.setPOIs(this.pois);
    worker.setPathfinder(this.pathfinder);
    worker.sprite.setCollideWorldBounds(true);
    return worker;
  }

  syncWorkers(seats: SeatState[], clearNearest: (worker: Worker) => void) {
    this.lastSync = { seats, clearNearest };
    const nextBySeatId = new Map(
      seats.filter((seat) => seat.assigned && seat.spriteKey).map((seat) => [seat.seatId, seat]),
    );
    const existingBySeatId = new Map(this.workers.map((worker) => [worker.seatId, worker]));
    const nextWorkers: Worker[] = [];

    for (const seatDef of this.seatDefs) {
      const seat = nextBySeatId.get(seatDef.seatId);
      const existing = existingBySeatId.get(seatDef.seatId);

      if (!seat) {
        if (existing) {
          this.cleanupWorkerRunIds(existing);
          clearNearest(existing);
          existing.destroy();
          existingBySeatId.delete(seatDef.seatId);
        }
        continue;
      }

      const needsRecreate =
        !existing || existing.spriteKey !== seat.spriteKey || existing.label !== seat.label;

      if (needsRecreate) {
        if (existing) {
          this.cleanupWorkerRunIds(existing);
          clearNearest(existing);
          existing.destroy();
          existingBySeatId.delete(seatDef.seatId);
        }
        const created = this.spawnWorker(seatDef, seat);
        if (created) nextWorkers.push(created);
        continue;
      }

      nextWorkers.push(existing);
      existingBySeatId.delete(seatDef.seatId);
    }

    for (const stale of existingBySeatId.values()) {
      this.cleanupWorkerRunIds(stale);
      clearNearest(stale);
      stale.destroy();
    }

    this.workers = nextWorkers;
  }

  cleanupWorkerRunIds(worker: Worker) {
    if (worker.assignedRunId) this.runWorkerMap.delete(worker.assignedRunId);
    for (const task of worker.taskQueue) {
      this.runWorkerMap.delete(task.runId);
    }
  }

  findBySeatId(seatId?: string): Worker | null {
    if (!seatId) return null;
    return this.workers.find((worker) => worker.seatId === seatId) ?? null;
  }

  /**
   * Find the worker that owns a run. runWorkerMap is cleared the moment a task
   * completes, but a final reply can arrive just after, so fall back to the
   * worker still holding the run while it shows its result.
   */
  findByRunId(runId: string): Worker | null {
    return (
      this.runWorkerMap.get(runId) ??
      this.workers.find((worker) => worker.assignedRunId === runId) ??
      null
    );
  }

  findIdle(): Worker | null {
    return this.workers.find((worker) => worker.status === "idle") ?? null;
  }

  updateAll() {
    for (const worker of this.workers) worker.update();
  }

  destroyAll() {
    for (const worker of this.workers) worker.destroy();
    this.workers = [];
    this.runWorkerMap.clear();
  }
}
