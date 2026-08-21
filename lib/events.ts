import type { SeatState } from "@/types/game";
import type { SeatDef } from "@/components/game/utils/MapHelpers";
import type { PresencePlayer } from "./presence-types";
import { createLogger } from "./logger";

const log = createLogger("GameEventBus");

export interface GameEventMap {
  "seats-discovered": [seats: SeatDef[]];
  "seat-configs-updated": [seats: SeatState[]];
  "task-assigned": [taskId: string, message: string, seatId?: string, sessionKey?: string];
  "task-routed": [taskId: string, seatId: string, actorName: string];
  "task-ready": [taskId: string, message: string, seatId?: string];
  "task-bound": [taskId: string, runId: string];
  "task-staged": [taskId: string, stage: "queued" | "returning", seatId?: string];
  "task-bubble": [runId: string, text: string, ttl: number];
  /** Gamepad shoulder buttons cycle HUD panels; Back closes the open one. */
  "hud-cycle-panel": [direction: -1 | 1];
  "hud-close-panel": [];
  /** Where this browser's own character is, for the room socket to send on. */
  "player-moved": [position: { x: number; y: number; facing: string; moving: boolean }];
  /** Everyone else in the room, as the server last reported them. */
  "presence-updated": [players: PresencePlayer[]];
  /** A remote player disconnected and should be removed immediately. */
  "presence-left": [id: string];
  /** How many humans are in the room, for the HUD. */
  "presence-count": [count: number, capacity: number];
  /** What the room has spent on agents, and the ceiling it stops at. */
  "budget-updated": [spentUsd: number, limitUsd: number, halted: boolean];
  /** A badge was just earned, by a person or an agent. */
  "achievement-earned": [
    achievement: {
      code: string;
      subjectType: "agent" | "human";
      subjectId: string;
      subjectName: string;
      title: string;
      description: string;
      icon: string;
    },
  ];
  /** Someone said something out loud: show it over their character. */
  "player-said": [playerId: string, text: string];
  /** This browser's own remark, to show over our own character. */
  "self-said": [text: string];
  "task-aborted": [runId: string];
  "task-completed": [runId: string];
  "task-failed": [runId: string];
  "subagent-assigned": [runId: string, parentRunId: string, label: string, seatId?: string];
  "open-terminal": [seatId?: string];
  "open-terminal-queue": [seatId: string];
  "stop-task": [runId: string, seatId: string];
  "terminal-closed": [];
  "new-session-for-seat": [seatId: string];
  "open-session-history": [seatId: string];
}

type Listener<T extends unknown[]> = (...args: T) => void;

class GameEventBus {
  private listeners = new Map<string, Set<Listener<unknown[]>>>();

  on<K extends keyof GameEventMap>(event: K, fn: Listener<GameEventMap[K]>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn as Listener<unknown[]>);
    return () => this.off(event, fn);
  }

  off<K extends keyof GameEventMap>(event: K, fn: Listener<GameEventMap[K]>) {
    this.listeners.get(event)?.delete(fn as Listener<unknown[]>);
  }

  emit<K extends keyof GameEventMap>(event: K, ...args: GameEventMap[K]) {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        fn(...args);
      } catch (err) {
        log.error(`listener error on "${event}":`, err);
      }
    });
  }
}

export const gameEvents = new GameEventBus();
