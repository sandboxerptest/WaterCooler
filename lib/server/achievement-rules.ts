/**
 * When achievements are earned.
 *
 * Evaluated on the server for the same reason spend is: a client could simply
 * claim a badge. Each rule is cheap — a single counter query at most — because
 * these run on every task completion and every remark.
 */

import { getRoomStore } from "./room-store";
import { achievementFor, type EarnedAchievement } from "../achievements";
import { createLogger } from "../logger";

const log = createLogger("Achievements");

/** A task that just finished, as the bridge sees it. */
export interface CompletedRun {
  room: string;
  seatId?: string;
  seatLabel: string;
  durationMs: number;
  costUsd?: number;
  /** True when another agent handed this down rather than a human. */
  dispatched: boolean;
  /** Humans in the room at the moment it finished. */
  humansPresent: number;
}

const MARATHON_MS = 120_000;
const FRUGAL_USD = 0.01;

function grant(
  room: string,
  subjectType: "agent" | "human",
  subjectId: string,
  subjectName: string,
  code: string,
  earned: EarnedAchievement[],
) {
  const definition = achievementFor(code);
  if (!definition) return;

  if (!getRoomStore().award(room, subjectType, subjectId, code, subjectName)) return;

  log.info(`${subjectName} earned "${definition.title}" in ${room}`);
  earned.push({
    code,
    subjectType,
    subjectId,
    subjectName,
    earnedAt: new Date().toISOString(),
  });
}

/** Badges an agent may have just earned by finishing a piece of work. */
export function onRunCompleted(run: CompletedRun): EarnedAchievement[] {
  const earned: EarnedAchievement[] = [];
  const subjectId = run.seatId ?? run.seatLabel;
  if (!subjectId) return earned;

  const give = (code: string) => grant(run.room, "agent", subjectId, run.seatLabel, code, earned);

  try {
    // The store already holds this run, so one completion means it is the first
    if (run.seatId && getRoomStore().countCompletedTasksForSeat(run.room, run.seatId) <= 1) {
      give("first-words");
    }
    if (run.dispatched) give("sub-contractor");
    if (run.humansPresent === 0) give("night-shift");
    if (run.durationMs >= MARATHON_MS) give("marathon");
    if (typeof run.costUsd === "number" && run.costUsd > 0 && run.costUsd < FRUGAL_USD) {
      give("frugal");
    }
  } catch (err) {
    // Never let a badge take down a run that already succeeded
    log.warn("could not evaluate run achievements:", (err as Error).message);
  }

  return earned;
}

export function onPlayerJoined(room: string, name: string): EarnedAchievement[] {
  const earned: EarnedAchievement[] = [];
  grant(room, "human", name, name, "walked-in", earned);
  return earned;
}

export function onPlayerSpoke(
  room: string,
  name: string,
  scope: "room" | "nearby",
  isFirstInRoom: boolean,
): EarnedAchievement[] {
  const earned: EarnedAchievement[] = [];
  if (isFirstInRoom) grant(room, "human", name, name, "icebreaker", earned);
  if (scope === "nearby") grant(room, "human", name, name, "whisperer", earned);
  return earned;
}

/** Everyone present when the office filled up shares the moment. */
export function onRoomFull(room: string, names: string[]): EarnedAchievement[] {
  const earned: EarnedAchievement[] = [];
  for (const name of names) grant(room, "human", name, name, "full-house", earned);
  return earned;
}

/** Checked after a task is created: did this person cover every staffed seat? */
export function onTaskAssigned(room: string, requesterName: string): EarnedAchievement[] {
  const earned: EarnedAchievement[] = [];
  try {
    const { assigned, staffed } = getRoomStore().assignmentBreadth(room, requesterName);
    if (staffed > 1 && assigned >= staffed) {
      grant(room, "human", requesterName, requesterName, "foreman", earned);
    }
  } catch (err) {
    log.warn("could not evaluate assignment breadth:", (err as Error).message);
  }
  return earned;
}
