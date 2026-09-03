"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelRightClose } from "lucide-react";
import { useStudio } from "@/lib/store";
import { isVisibleChatMessage } from "@/lib/constants";
import { MAIN_SESSION_KEY } from "@/lib/reducer";
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@/lib/constants";
import { saveSidebarWidth } from "@/lib/persistence";
import ChatPanel from "./ChatPanel";
import ActivityPanel from "./ActivityPanel";
import { TaskList } from "./TaskPanel";
import AchievementsPanel from "./AchievementsPanel";
import PeoplePanel from "./PeoplePanel";
import { useOnline } from "@/lib/presence-online";

/**
 * The column that stays.
 *
 * Chat used to be a flyout over the office, which meant the record of what
 * the agents had actually done — the figures they looked up, the answers they
 * gave — was hidden behind a button, and hid the room when you opened it.
 * Here it has a home of its own, alongside the office rather than on top of it.
 */

export type SidebarTab = "chat" | "activity" | "tasks" | "badges" | "people";

interface SidebarProps {
  open: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

export default function Sidebar({ open, width, onWidthChange, onClose }: SidebarProps) {
  const { state } = useStudio();
  const [tab, setTab] = useState<SidebarTab>("chat");
  const online = useOnline();
  const draggingRef = useRef(false);

  const activeSessionKey = state.activeSessionKey ?? MAIN_SESSION_KEY;
  // Room talk stays in view whichever session is being read: the person you
  // are talking to may well be looking at a different one
  const messages = state.chatMessages.filter(
    (message) =>
      (message.roomChat || message.role === "player" || message.sessionKey === activeSessionKey) &&
      isVisibleChatMessage(message),
  );
  const tasks = state.tasks.filter((task) => task.sessionKey === activeSessionKey);
  /** The Tasks tab is about the room, so it shows the lot. */
  const busyCount = state.tasks.filter((task) =>
    ["running", "submitted", "queued", "returning"].includes(task.status),
  ).length;

  // ── Dragging the edge ──
  const startDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    // Capture keeps the drag alive when the pointer runs ahead of the edge.
    // It throws if the browser has already let the pointer go, and losing it
    // must not cost the drag — or, worse, the width that came out of it.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The drag works either way
    }
  }, []);

  const onDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      // Measured from the right edge of the window, so the handle stays under
      // the pointer however the window is sized
      const next = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - event.clientX),
      );
      onWidthChange(next);
    },
    [onWidthChange],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      // Remember the width first: releasing the capture can throw, and the
      // width the reader just chose is the thing worth keeping
      saveSidebarWidth(width);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Nothing to release
      }
    },
    [width],
  );

  // Double-click the handle to go back to a sensible width
  const resetWidth = useCallback(() => {
    onWidthChange(SIDEBAR_DEFAULT_WIDTH);
    saveSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  }, [onWidthChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // Escape closes the drawer on a phone, where it covers the office
      if (event.key === "Escape" && window.innerWidth < 900) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside className="app-sidebar" style={{ width }} aria-label="Chat and activity">
      <div
        className="app-sidebar__handle"
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={resetWidth}
        role="separator"
        aria-label="Drag to resize"
      />

      <div className="app-sidebar__body">
        <div className="app-sidebar__tabs">
          <button
            type="button"
            className={`app-sidebar__tab${tab === "chat" ? " is-active" : ""}`}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className={`app-sidebar__tab${tab === "activity" ? " is-active" : ""}`}
            onClick={() => setTab("activity")}
          >
            Activity
          </button>
          <button
            type="button"
            className={`app-sidebar__tab${tab === "tasks" ? " is-active" : ""}`}
            onClick={() => setTab("tasks")}
          >
            Tasks
            {busyCount > 0 && <span className="app-sidebar__count">{busyCount}</span>}
          </button>
          <button
            type="button"
            className={`app-sidebar__tab${tab === "badges" ? " is-active" : ""}`}
            onClick={() => setTab("badges")}
          >
            Badges
          </button>
          <button
            type="button"
            className={`app-sidebar__tab${tab === "people" ? " is-active" : ""}`}
            onClick={() => setTab("people")}
            title="Everyone online, and where they are"
          >
            People
            {online.length > 0 && <span className="app-sidebar__count">{online.length}</span>}
          </button>
          <button
            type="button"
            className="app-sidebar__collapse"
            onClick={onClose}
            title="Hide the panel"
            aria-label="Hide the panel"
          >
            <PanelRightClose size={14} />
          </button>
        </div>

        <div className="app-sidebar__content">
          {tab === "chat" ? (
            <ChatPanel
              messages={messages}
              tasks={tasks}
              isConnected={state.connection === "connected"}
              sessions={state.sessions}
              activeSessionKey={state.activeSessionKey}
            />
          ) : tab === "activity" ? (
            <ActivityPanel />
          ) : tab === "tasks" ? (
            <div className="app-sidebar__scroll">
              <TaskList tasks={state.tasks} />
            </div>
          ) : tab === "people" ? (
            <PeoplePanel />
          ) : (
            <AchievementsPanel />
          )}
        </div>
      </div>
    </aside>
  );
}
