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
  /**
   * A dialog is open and the pad is driving it: move the focus ring, and
   * press or release whatever it is sitting on. The scene owns the only
   * gamepad poll, so the buttons reach React as events rather than a second
   * reader of the Gamepad API.
   */
  "hud-focus-move": [delta: -1 | 1];
  "hud-confirm": [phase: "down" | "up"];
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
  /** A controller appeared or went away, with its layout for prompts. */
  "gamepad-state": [id: string | null, layout: string];
  /**
   * The on-screen action button, which stands in for the E key. A phone has
   * no keyboard, and walking up to something is only half of using it.
   */
  "interact-pressed": [];
  /** Somebody walked up to the water bucket and pressed E. */
  "open-pingpong": [];
  /** The ping pong table was closed, so the office takes input again. */
  "pingpong-closed": [];
  /** Somebody walked up to the cauldron and pressed E. */
  "open-pinball": [];
  /** The cauldron was closed, so the office takes input again. */
  "pinball-closed": [];
  /** Somebody walked up to a board and pressed E. */
  "open-whiteboard": [];
  /** The board was closed, so the office takes input again. */
  "whiteboard-closed": [];
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
  /**
   * The player walked into a doorway. `target` names the room it leads to;
   * nothing loads it yet, so today this is how we prove the seam works.
   */
  "transition-entered": [name: string, target: string];
  /** The person stepped into the lift; the HUD offers the floors. */
  "open-elevator": [];
  /** The lift's menu closed, chosen or not; the keys are the character's again. */
  "elevator-closed": [];
  /**
   * The person chose a different look for themselves. The sheet is fetched
   * and the texture swapped in the scene; nothing about the world changes.
   */
  "player-sprite-chosen": [spriteKey: string, spritePath: string];
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
