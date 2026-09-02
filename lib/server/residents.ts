/**
 * Walks the residents about.
 *
 * Each resident keeps a loose routine — their office, the lobby, outside —
 * and while they are in a room they are a player in that room's presence
 * hub like anyone else, so the people there see them wander. They take no
 * human seat and never time out. Outside has no room; the world map asks
 * where everyone is instead (see /api/residents).
 *
 * The simulation owns its clock and randomness so it can be driven by hand
 * in tests.
 */

import type { PresenceHub } from "./presence-hub";
import type { Facing } from "../presence-types";
import {
  RESIDENTS,
  deskSpot,
  dwell,
  nextPlace,
  roomForPlace,
  wanderArea,
  type Place,
  type Rect,
  type Resident,
  type Whereabouts,
} from "../world/residents";
import { createLogger } from "../logger";

const log = createLogger("Residents");

/** Slower than a person: nobody wanders at a march. */
export const WANDER_SPEED_PX_S = 55;
const PAUSE_MS: [number, number] = [1500, 4000];
const TICK_MS = 120;

export interface ResidentHost {
  /** The room's hub, opening the room if it is not. */
  roomFor(slug: string): { hub: PresenceHub };
}

export interface ResidentOptions {
  now?: () => number;
  random?: () => number;
  /** Where every resident starts. */
  startAt?: Place;
  /** Multiplies every stay; below 1 to watch a whole day go by quickly. */
  dwellScale?: number;
}

interface State {
  resident: Resident;
  place: Place;
  room: string | null;
  since: number;
  until: number;
  x: number;
  y: number;
  target: { x: number; y: number } | null;
  pauseUntil: number;
  facing: Facing;
  lastTick: number;
}

/** How a route handler, in its own module graph, reaches the running simulation. */
const WHEREABOUTS_KEY = Symbol.for("watercooler.residents.whereabouts");

/** Where every resident is right now; their offices when nothing is running. */
export function residentWhereabouts(): Whereabouts[] {
  const read = (globalThis as Record<symbol, unknown>)[WHEREABOUTS_KEY] as
    | (() => Whereabouts[])
    | undefined;
  if (read) return read();
  return RESIDENTS.map((r) => ({
    id: r.id,
    name: r.name,
    title: r.title,
    spriteKey: r.spriteKey,
    tenant: r.tenant,
    place: "office",
    room: roomForPlace(r, "office"),
    since: 0,
  }));
}

export const presenceIdFor = (resident: Resident) => `resident:${resident.id}`;

export class ResidentSimulation {
  private states = new Map<string, State>();
  private now: () => number;
  private random: () => number;
  private dwellScale: number;

  constructor(
    private host: ResidentHost,
    options: ResidentOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.dwellScale = options.dwellScale ?? 1;
    const at = this.now();
    for (const resident of RESIDENTS) {
      const place = options.startAt ?? "office";
      this.states.set(resident.id, {
        resident,
        place,
        room: null,
        since: at,
        until: at + this.stay(place),
        x: 0,
        y: 0,
        target: null,
        pauseUntil: 0,
        facing: "down",
        lastTick: at,
      });
      this.arrive(this.states.get(resident.id)!, place, at);
    }
  }

  /** Run on a timer until the returned function is called. */
  start(): () => void {
    (globalThis as Record<symbol, unknown>)[WHEREABOUTS_KEY] = () => this.whereabouts();
    const timer = setInterval(() => this.tick(this.now()), TICK_MS);
    timer.unref?.();
    log.info(`${RESIDENTS.map((r) => r.name).join(", ")} clocked in`);
    return () => {
      clearInterval(timer);
      for (const state of this.states.values()) this.leaveRoom(state);
      delete (globalThis as Record<symbol, unknown>)[WHEREABOUTS_KEY];
    };
  }

  whereabouts(): Whereabouts[] {
    return [...this.states.values()].map((s) => ({
      id: s.resident.id,
      name: s.resident.name,
      title: s.resident.title,
      spriteKey: s.resident.spriteKey,
      tenant: s.resident.tenant,
      place: s.place,
      room: s.room,
      since: s.since,
    }));
  }

  /** One step of everyone's day. */
  tick(now: number) {
    for (const state of this.states.values()) {
      if (now >= state.until) {
        const next = nextPlace(state.place, this.random);
        this.leaveRoom(state);
        this.arrive(state, next, now);
        state.until = now + this.stay(next);
        log.info(
          `${state.resident.name} went ${next === "outside" ? "outside" : `to the ${next}`}`,
        );
      }
      if (state.room) this.wander(state, now);
      state.lastTick = now;
    }
  }

  private stay(place: Place): number {
    return Math.max(1000, dwell(place, this.random) * this.dwellScale);
  }

  private arrive(state: State, place: Place, now: number) {
    state.place = place;
    state.since = now;
    state.room = roomForPlace(state.resident, place);
    state.target = null;
    state.pauseUntil = now + 800;
    const area = wanderArea(place);
    if (area) {
      state.x = area.x + area.width / 2;
      state.y = area.y + area.height / 2;
      state.facing = "down";
    } else if (place === "office") {
      // At the desk, facing it, and staying put.
      const spot = deskSpot(state.resident);
      state.x = spot.x;
      state.y = spot.y;
      state.facing = "up";
    }
    if (state.room) this.ensureInRoom(state);
  }

  private ensureInRoom(state: State) {
    if (!state.room) return;
    const { hub } = this.host.roomFor(state.room);
    const id = presenceIdFor(state.resident);
    if (hub.has(id)) return;
    hub.join(id, {
      name: state.resident.name,
      spriteKey: state.resident.spriteKey,
      x: state.x,
      y: state.y,
      facing: state.facing,
      resident: true,
    });
  }

  private leaveRoom(state: State) {
    if (!state.room) return;
    this.host.roomFor(state.room).hub.leave(presenceIdFor(state.resident));
    state.room = null;
  }

  private wander(state: State, now: number) {
    if (!state.room) return;
    // The room may have been closed and reopened while nobody was there.
    this.ensureInRoom(state);
    const { hub } = this.host.roomFor(state.room);
    const id = presenceIdFor(state.resident);
    const area = wanderArea(state.place);
    if (!area) {
      hub.move(id, { x: state.x, y: state.y, facing: state.facing, moving: false });
      return;
    }

    let moving = false;
    if (now >= state.pauseUntil) {
      if (!state.target) state.target = randomPoint(area, this.random);
      const dx = state.target.x - state.x;
      const dy = state.target.y - state.y;
      const distance = Math.hypot(dx, dy);
      const step = (WANDER_SPEED_PX_S * (now - state.lastTick)) / 1000;
      if (distance <= step) {
        state.x = state.target.x;
        state.y = state.target.y;
        state.target = null;
        state.pauseUntil = now + PAUSE_MS[0] + this.random() * (PAUSE_MS[1] - PAUSE_MS[0]);
      } else {
        state.x += (dx / distance) * step;
        state.y += (dy / distance) * step;
        state.facing =
          Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        moving = true;
      }
    }
    hub.move(id, { x: state.x, y: state.y, facing: state.facing, moving });
  }
}

function randomPoint(area: Rect, random: () => number) {
  return { x: area.x + random() * area.width, y: area.y + random() * area.height };
}
