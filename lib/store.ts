"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useEffect,
  type Dispatch,
  type ReactNode,
} from "react";
import React from "react";
import type { SeatState, TaskItem, GatewayConfig, ChatMessage } from "@/types/game";
import type { StudioSnapshot } from "@/types/game";
import { gameEvents } from "./events";
import { type PersistedSeatConfig, loadGatewayConfig, loadPlayerName } from "./persistence";
import { say } from "./room-speech";
import type { SayScope } from "./presence-types";
import { fetchRoomSnapshot, flushRoomWrites, saveRoomPatch } from "./room-client";
import {
  type Action,
  reducer,
  initialState,
  findTask,
  mergeDiscoveredSeats,
  MAIN_SESSION_KEY,
} from "./reducer";
import { useGateway } from "./hooks/useGateway";
import { useSession } from "./hooks/useSession";
import { useTaskRouter } from "./hooks/useTaskRouter";
import { usePresence } from "./hooks/usePresence";
import { useWorldSync } from "./hooks/useWorldSync";
import { primeFromSnapshot, syncMessages, syncSeats, syncSessions, syncTasks } from "./room-sync";
import { isCliProvider, getDefaultGatewayUrl } from "./utils";

// ── Context ────────────────────────────────────────────

interface StudioContextValue {
  state: StudioSnapshot;
  connect: (config?: GatewayConfig) => void;
  disconnect: () => void;
  assignTask: (message: string, seatId?: string) => void;
  updateSeatConfig: (seatId: string, patch: Partial<SeatState>) => void;
  newSession: () => void;
  switchSession: (sessionKey: string) => void;
  prepareSessionForSeat: (seatId: string) => Promise<void>;
  newSessionForSeat: (seatId: string) => void;
  getBoundSessionForSeat: (seatId: string) => string | undefined;
  loadSessionChat: (sessionKey: string) => Promise<ChatMessage[]>;
  /** Say something to the room, and keep it in the chat log. */
  sayInRoom: (text: string, scope?: SayScope) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used within StudioProvider");
  return ctx;
}

// ── Provider ───────────────────────────────────────────

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const dispatchRef = useRef<Dispatch<Action>>(dispatch);
  dispatchRef.current = dispatch;
  const tasksRef = useRef<TaskItem[]>(state.tasks);
  tasksRef.current = state.tasks;
  const seatsRef = useRef<SeatState[]>(state.seats);
  seatsRef.current = state.seats;
  const seatConfigRef = useRef<PersistedSeatConfig[]>([]);
  const activeSessionKeyRef = useRef<string | undefined>(undefined);
  const taskCounterRef = useRef(0);

  /** True once the server snapshot has been applied; gates all writes. */
  const hydratedRef = useRef(false);
  /** Last seat layout the scene reported, so hydration can re-merge it. */
  const discoveredSeatsRef = useRef<Parameters<typeof mergeDiscoveredSeats>[0] | null>(null);

  const applySeatMerge = useCallback((discovered: Parameters<typeof mergeDiscoveredSeats>[0]) => {
    const mergedSeats = mergeDiscoveredSeats(discovered, seatConfigRef.current, seatsRef.current);
    dispatchRef.current({ type: "SYNC_SEATS", seats: mergedSeats });
  }, []);

  const setActiveSessionKey = useCallback((sessionKey?: string) => {
    activeSessionKeyRef.current = sessionKey;
    saveRoomPatch({ activeSessionKey: sessionKey ?? null });
    dispatchRef.current({ type: "SET_ACTIVE_SESSION", sessionKey });
  }, []);

  // ── Gateway hook ──
  const gateway = useGateway({
    dispatch: dispatchRef,
    tasks: tasksRef,
    seats: seatsRef,
    activeSessionKey: activeSessionKeyRef,
    setActiveSessionKey,
    taskCounter: taskCounterRef,
  });

  const setActiveSessionKeyDirect = useCallback((key: string | undefined) => {
    activeSessionKeyRef.current = key;
  }, []);

  // ── Session hook ──
  const session = useSession({
    dispatch: dispatchRef,
    clientRef: gateway.clientRef,
    activeSessionKey: activeSessionKeyRef,
    setActiveSessionKey: setActiveSessionKeyDirect,
    seenStarts: gateway.seenStartsRef,
    bubbleAccum: gateway.bubbleAccumRef,
    stoppedRunIds: gateway.stoppedRunIdsRef,
  });

  // ── Task router hook ──
  const taskRouter = useTaskRouter({
    dispatch: dispatchRef,
    clientRef: gateway.clientRef,
    tasks: tasksRef,
    seats: seatsRef,
    activeSessionKey: activeSessionKeyRef,
    seatIdToSessionKey: session.seatIdToSessionKeyRef,
    stoppedRunIds: gateway.stoppedRunIdsRef,
    runActors: gateway.runActorRef,
    nextTaskId: () => `aw_task_${++taskCounterRef.current}_${Date.now()}`,
  });

  // Keep this browser's character on the room socket
  usePresence();
  // Apply world changes made by the other people in it
  useWorldSync({
    dispatch: dispatchRef,
    seatConfigs: seatConfigRef,
    seats: seatsRef,
    tasks: tasksRef,
    activeSessionKey: activeSessionKeyRef,
  });

  // ── Bootstrap: restore world state from the server + auto-connect ──
  const inflightTaskIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const savedConfig = loadGatewayConfig();
    if (savedConfig) gateway.configRef.current = savedConfig;

    let cancelled = false;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;

    const bootstrap = async () => {
      const snapshot = await fetchRoomSnapshot(MAIN_SESSION_KEY);
      if (cancelled) return;

      const savedActiveKey = snapshot.activeSessionKey ?? undefined;
      const fallbackSessionKey = savedActiveKey ?? MAIN_SESSION_KEY;
      const tasks = snapshot.tasks;
      const chat = snapshot.messages;
      const sessions = snapshot.sessions;
      seatConfigRef.current = snapshot.seats;

      // Everything in the snapshot is already in the room; recording it stops
      // the first diff treating the restored world as brand new and shouting
      // all of it back at everyone.
      primeFromSnapshot({ tasks, messages: chat, seats: snapshot.seats, sessions });

      if (snapshot.budget) {
        gameEvents.emit(
          "budget-updated",
          snapshot.budget.spentUsd,
          snapshot.budget.limitUsd,
          snapshot.budget.halted,
        );
      }

      // Writes are blocked until this point: the save effects run on mount with
      // empty state, and against a server that would erase the room before its
      // contents arrived.
      hydratedRef.current = true;

      // The scene may already have reported its seats while the snapshot was in
      // flight; re-merge so restored names and roles are not lost.
      if (discoveredSeatsRef.current) {
        applySeatMerge(discoveredSeatsRef.current);
      }

      const hasRestoredData = tasks.length > 0 || chat.length > 0 || sessions.length > 0;
      activeSessionKeyRef.current =
        savedActiveKey ?? (hasRestoredData ? MAIN_SESSION_KEY : undefined);

      if (hasRestoredData) {
        dispatch({
          type: "RESTORE",
          tasks,
          chatMessages: chat,
          sessions,
          activeSessionKey: fallbackSessionKey,
        });
      }
      if (activeSessionKeyRef.current) {
        dispatch({ type: "SET_ACTIVE_SESSION", sessionKey: activeSessionKeyRef.current });
        saveRoomPatch({ activeSessionKey: activeSessionKeyRef.current });
      }

      // Track inflight tasks so other effects can reference them
      const inflight = tasks.filter(
        (t) => t.status === "running" || t.status === "submitted" || t.status === "returning",
      );
      inflightTaskIdsRef.current = inflight.map((t) => t.taskId);
      for (const t of inflight) {
        if (t.runId) gateway.seenStartsRef.current.add(t.runId);
        gateway.seenStartsRef.current.add(t.taskId);
        if (t.actorName && t.runId) gateway.runActorRef.current.set(t.runId, t.actorName);
      }

      // Auto-connect: immediately for CLI providers (no config needed), or if
      // config was saved for OpenClaw
      if (isCliProvider()) {
        connectTimer = setTimeout(
          () => gateway.connectImpl({ url: getDefaultGatewayUrl(), token: "" }),
          80,
        );
      } else if (savedConfig?.url) {
        connectTimer = setTimeout(() => gateway.connectImpl(savedConfig), 80);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      if (connectTimer) clearTimeout(connectTimer);
      // Anything still queued would otherwise be lost on navigation
      void flushRoomWrites();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Seat sync: merge discovered seats with persisted configs ──
  useEffect(() => {
    const unsub = gameEvents.on("seats-discovered", (discovered) => {
      discoveredSeatsRef.current = discovered;
      applySeatMerge(discovered);

      for (const task of tasksRef.current) {
        if (
          task.seatId &&
          (task.status === "running" || task.status === "submitted" || task.status === "returning")
        ) {
          dispatchRef.current({
            type: "PATCH_SEAT_RUNTIME",
            seatId: task.seatId,
            patch: {
              status: task.status === "returning" ? "returning" : "running",
              runId: task.runId ?? task.taskId,
              taskSnippet: task.message.slice(0, 28),
              startedAt: task.createdAt,
            },
          });
        }
      }
    });
    return unsub;
  }, [applySeatMerge]);

  // ── Stale task cleanup: mark inflight tasks as interrupted after timeout ──
  useEffect(() => {
    const inflightIds = inflightTaskIdsRef.current;
    if (inflightIds.length === 0) return;

    const timer = setTimeout(() => {
      for (const taskId of inflightIds) {
        const current = findTask(tasksRef.current, taskId);
        if (
          current &&
          (current.status === "running" ||
            current.status === "submitted" ||
            current.status === "returning")
        ) {
          dispatchRef.current({
            type: "UPDATE_TASK",
            taskId: current.taskId,
            patch: { status: "interrupted", completedAt: new Date().toISOString() },
          });
          if (current.runId) {
            dispatchRef.current({
              type: "SET_SEAT_STATUS",
              runId: current.runId,
              status: "empty",
            });
          }
        }
      }
    }, 20_000);

    return () => clearTimeout(timer);
  }, []);

  // ── Share tasks, chat and sessions with the room ──
  // One change at a time: sending whole collections would let a second player's
  // write erase work this client had not heard about yet.
  useEffect(() => {
    if (!hydratedRef.current) return;
    syncTasks(state.tasks);
    syncMessages(state.chatMessages);
    syncSessions(state.sessions);
  }, [state.tasks, state.chatMessages, state.sessions]);

  useEffect(() => {
    const configs: PersistedSeatConfig[] = state.seats.map((seat) => ({
      seatId: seat.seatId,
      label: seat.label,
      seatType: seat.seatType,
      roleTitle: seat.roleTitle,
      assigned: seat.assigned,
      spriteKey: seat.spriteKey,
      spritePath: seat.spritePath,
      agentConfig: seat.agentConfig,
    }));
    seatConfigRef.current = configs;
    if (hydratedRef.current) syncSeats(configs);
    gameEvents.emit("seat-configs-updated", state.seats);
    // The agent bridge reads the roster from the room store, so syncSeats above
    // is the only thing it needs; a separate push from each browser is what
    // used to let one client's empty view wipe everyone's roster.
  }, [state.seats]);

  // ── Cleanup ──
  useEffect(() => {
    const sessionTimer = gateway.sessionRefreshTimerRef;
    const bubbleTimers = gateway.bubbleThrottleTimersRef;
    const client = gateway.clientRef;
    return () => {
      if (sessionTimer.current) {
        clearTimeout(sessionTimer.current);
      }
      for (const timer of bubbleTimers.current.values()) {
        clearTimeout(timer);
      }
      client.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSeatConfig = useCallback((seatId: string, patch: Partial<SeatState>) => {
    dispatchRef.current({ type: "UPDATE_SEAT_CONFIG", seatId, patch });
  }, []);

  /**
   * Say something out loud, and put it in the chat log with everything else.
   *
   * The server relays speech to everyone else and deliberately does not echo
   * it back to the speaker, so without this your own words appear over your
   * character and nowhere else — leaving the log reading as though everyone
   * were talking at you rather than with you.
   */
  const sayInRoom = useCallback((text: string, scope: SayScope = "room") => {
    const trimmed = text.trim().slice(0, 500);
    if (!trimmed || !say(trimmed, scope)) return;

    dispatchRef.current({
      type: "UPSERT_CHAT",
      message: {
        id: `said-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        runId: "",
        role: "player",
        content: trimmed,
        actorName: loadPlayerName(),
        timestamp: new Date().toISOString(),
        sessionKey: MAIN_SESSION_KEY,
        roomChat: true,
      } as ChatMessage,
    });
  }, []);

  return React.createElement(
    StudioContext.Provider,
    {
      value: {
        state,
        connect: gateway.connect,
        disconnect: gateway.disconnect,
        assignTask: taskRouter.assignTask,
        updateSeatConfig,
        newSession: session.newSession,
        switchSession: session.switchSession,
        prepareSessionForSeat: session.prepareSessionForSeat,
        newSessionForSeat: session.newSessionForSeat,
        getBoundSessionForSeat: session.getBoundSessionForSeat,
        loadSessionChat: session.loadSessionChat,
        sayInRoom,
      },
    },
    children,
  );
}
