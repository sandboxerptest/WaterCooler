"use client";

import { useEffect, type Dispatch, type MutableRefObject } from "react";
import type { Action } from "../reducer";
import type { TaskItem, ChatMessage, SessionRecord, SeatState } from "@/types/game";
import type { PersistedSeatConfig } from "../persistence";
import { acquireRoomSocket, onRoomMessage } from "../room-socket";
import { gameEvents } from "../events";
import { markKnown } from "../room-sync";
import { createLogger } from "../logger";

const log = createLogger("WorldSync");

export interface WorldSyncRefs {
  dispatch: MutableRefObject<Dispatch<Action>>;
  /** Seat configs as this client last built them, for merging remote edits. */
  seatConfigs: MutableRefObject<PersistedSeatConfig[]>;
  seats: MutableRefObject<SeatState[]>;
  /** Current tasks, so a remote update can be compared against what we had. */
  tasks: MutableRefObject<TaskItem[]>;
  /** Which session the panel is showing, so speech lands where it is read. */
  activeSessionKey: MutableRefObject<string | undefined>;
}

/**
 * Applies world changes made by other people in the room.
 *
 * Everything arriving here was already persisted by the server, so this only
 * has to reflect it locally — and it does so with the received object itself,
 * which is what keeps the change from being echoed straight back.
 */
/** How long another player's finished answer stays in the worker's bubble. */
const REMOTE_RESULT_BUBBLE_MS = 8000;

/**
 * Turn another player's task into the same in-world performance the author
 * sees. Only transitions are acted on, so repeated updates for one task do not
 * send a worker walking to their desk over and over.
 */
function animateRemoteTask(task: TaskItem, previous?: TaskItem) {
  const status = task.status;
  const runId = task.runId ?? task.taskId;
  if (status === previous?.status) return;

  if (status === "submitted" || status === "running" || status === "returning") {
    if (!previous || previous.status === "queued") {
      gameEvents.emit("task-assigned", task.taskId, task.message, task.seatId, task.sessionKey);
      gameEvents.emit("task-bound", task.taskId, runId);
    }
    return;
  }

  if (status === "completed") {
    if (task.result) gameEvents.emit("task-bubble", runId, task.result, REMOTE_RESULT_BUBBLE_MS);
    gameEvents.emit("task-completed", runId);
    return;
  }

  if (status === "failed" || status === "interrupted") {
    gameEvents.emit("task-failed", runId);
  }
}

export function useWorldSync(refs: WorldSyncRefs) {
  useEffect(() => {
    const release = acquireRoomSocket();

    const unsubscribe = onRoomMessage((message) => {
      if (message.type === "achievement") {
        gameEvents.emit("achievement-earned", {
          code: message.code,
          subjectType: message.subjectType,
          subjectId: message.subjectId,
          subjectName: message.subjectName,
          title: message.title,
          description: message.description,
          icon: message.icon,
        });
        return;
      }

      if (message.type === "said") {
        // Humans get their own role so the panel and the bubbles can tell a
        // person apart from an agent at a glance.
        refs.dispatch.current({
          type: "UPSERT_CHAT",
          message: {
            id: message.id,
            runId: "",
            role: "player",
            content: message.text,
            actorName: message.from.name,
            timestamp: message.at,
            sessionKey: refs.activeSessionKey.current ?? "main",
          } as ChatMessage,
        });
        gameEvents.emit("player-said", message.from.id, message.text);
        return;
      }

      if (message.type !== "world") return;
      const { change, by } = message;

      switch (change.entity) {
        case "task": {
          const task = change.task as unknown as TaskItem;
          if (!task?.taskId) return;

          const previous = refs.tasks.current.find(
            (existing: TaskItem) => existing.taskId === task.taskId,
          );
          markKnown(`task:${task.taskId}`, task);
          refs.dispatch.current({ type: "UPSERT_TASK", task });
          log.debug(`task ${task.taskId} from ${by?.name ?? "someone"}`);

          // Someone else's task should look the same in this office as it does
          // in theirs: the worker walks to their desk, works, and reports back.
          animateRemoteTask(task, previous);
          break;
        }
        case "message": {
          const chatMessage = change.message as unknown as ChatMessage;
          if (!chatMessage?.id) return;
          markKnown(`message:${chatMessage.id}`, chatMessage);
          refs.dispatch.current({ type: "UPSERT_CHAT", message: chatMessage });
          break;
        }
        case "seat": {
          const seat = change.seat as unknown as PersistedSeatConfig;
          if (!seat?.seatId) return;
          markKnown(`seat:${seat.seatId}`, seat);

          // Seat runtime (who is working on what) is derived locally; only the
          // configuration travels between players.
          refs.dispatch.current({
            type: "UPDATE_SEAT_CONFIG",
            seatId: seat.seatId,
            patch: {
              label: seat.label,
              seatType: seat.seatType,
              roleTitle: seat.roleTitle,
              assigned: seat.assigned,
              spriteKey: seat.spriteKey,
              spritePath: seat.spritePath,
              agentConfig: seat.agentConfig,
            } as Partial<SeatState>,
          });
          break;
        }
        case "session": {
          const session = change.session as unknown as SessionRecord;
          const key =
            (session as unknown as { sessionKey?: string; key?: string }).sessionKey ??
            (session as unknown as { key?: string }).key;
          if (!key) return;
          markKnown(`session:${key}`, session);
          refs.dispatch.current({ type: "NEW_SESSION", session });
          break;
        }
      }
    });

    return () => {
      unsubscribe();
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
