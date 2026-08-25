"use client";

import { useEffect, useState } from "react";
import { onRoomMessage } from "@/lib/room-socket";
import { currentRoom } from "@/lib/room-client";
import { ACHIEVEMENTS, achievementFor } from "@/lib/achievements";
import { createLogger } from "@/lib/logger";

const log = createLogger("Achievements");

/**
 * The room's trophy wall.
 *
 * Earned ones first, with who earned them and when. The rest are listed below
 * in outline, because half the point of a badge is knowing it is there to be
 * had — a list of only what has been won says nothing about what is possible.
 */

interface Earned {
  subjectType: string;
  subjectId: string;
  code: string;
  subjectName: string;
  earnedAt: string;
}

function when(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AchievementsPanel() {
  const [earned, setEarned] = useState<Earned[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/room/achievements?room=${encodeURIComponent(currentRoom())}`,
        );
        const body = (await response.json()) as { earned?: Earned[] };
        if (!cancelled) setEarned(body.earned ?? []);
      } catch (err) {
        log.warn("could not read the badges:", (err as Error).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    // And keep up as they are won
    const unsubscribe = onRoomMessage((message) => {
      if (message.type !== "achievement") return;
      setEarned((current) =>
        current.some((e) => e.code === message.code && e.subjectId === message.subjectId)
          ? current
          : [
              ...current,
              {
                subjectType: message.subjectType,
                subjectId: message.subjectId,
                code: message.code,
                subjectName: message.subjectName,
                earnedAt: message.at,
              },
            ],
      );
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const wonCodes = new Set(earned.map((e) => e.code));
  const remaining = ACHIEVEMENTS.filter((a) => !wonCodes.has(a.code));

  return (
    <div className="app-sidebar__scroll badges">
      <div className="badges__count">
        {wonCodes.size} of {ACHIEVEMENTS.length} earned in this room
      </div>

      {earned.length === 0 && loaded && (
        <div className="badges__empty">
          None yet. They are earned by working, playing and turning up.
        </div>
      )}

      {[...earned].reverse().map((item) => {
        const badge = achievementFor(item.code);
        if (!badge) return null;
        return (
          <div key={`${item.code}-${item.subjectId}`} className="badges__row">
            <span className="badges__icon">{badge.icon}</span>
            <div>
              <div className="badges__title">{badge.title}</div>
              <div className="badges__detail">
                <span className="badges__who">{item.subjectName}</span> — {badge.description}
              </div>
            </div>
            <span className="badges__when">{when(item.earnedAt)}</span>
          </div>
        );
      })}

      {remaining.length > 0 && (
        <>
          <div className="badges__count badges__count--locked">Still out there</div>
          {remaining.map((badge) => (
            <div key={badge.code} className="badges__row badges__row--locked">
              <span className="badges__icon">{badge.icon}</span>
              <div>
                <div className="badges__title">{badge.title}</div>
                <div className="badges__detail">{badge.description}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
