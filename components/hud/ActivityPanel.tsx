"use client";

import { useEffect, useRef, useState } from "react";
import { onRoomMessage } from "@/lib/room-socket";
import { currentRoom } from "@/lib/room-client";
import { ACTIVITY_ICON, type ActivityEntry } from "@/lib/activity";
import { createLogger } from "@/lib/logger";

const log = createLogger("Activity");

/**
 * What the room has been doing.
 *
 * The catch-up comes from the store on open, and everything after that
 * arrives on the room socket — the same two paths the whiteboard uses, for
 * the same reason: a refresh should not lose the record.
 */
function timeOf(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function ActivityPanel() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/room/activity?room=${encodeURIComponent(currentRoom())}`,
        );
        const body = (await response.json()) as { entries?: ActivityEntry[] };
        if (!cancelled) setEntries(body.entries ?? []);
      } catch (err) {
        log.warn("could not load the log:", (err as Error).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    const unsubscribe = onRoomMessage((message) => {
      if (message.type !== "activity") return;
      setEntries((current) =>
        // The socket can repeat itself on reconnect; the position is the id
        current.some((entry) => entry.id === message.entry.id)
          ? current
          : [...current, message.entry],
      );
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Follow the newest line, unless the reader has scrolled back to look at
  // something — then leave them where they are
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [entries]);

  return (
    <div className="activity">
      <div
        className="activity__list"
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {entries.length === 0 ? (
          <div className="activity__empty">
            {loaded ? "Nothing has happened in this room yet." : "Reading the log…"}
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`activity__row activity__row--${entry.kind}`}>
              <span className="activity__icon" aria-hidden>
                {ACTIVITY_ICON[entry.kind] ?? "·"}
              </span>
              <div className="activity__body">
                <div className="activity__line">
                  <span className="activity__actor">{entry.actor}</span> {entry.text}
                </div>
                {entry.detail && <div className="activity__detail">{entry.detail}</div>}
              </div>
              <span className="activity__time">{timeOf(entry.at)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
