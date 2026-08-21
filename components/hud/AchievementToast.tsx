"use client";

import { useEffect, useState } from "react";
import { gameEvents } from "@/lib/events";

interface Toast {
  id: number;
  icon: string;
  title: string;
  who: string;
  description: string;
}

const VISIBLE_MS = 6000;

/**
 * Announces a badge to everyone in the room.
 *
 * Deliberately not a modal: the office keeps running underneath, and somebody
 * else's agent earning something should not interrupt your own work.
 */
export default function AchievementToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let nextId = 0;
    return gameEvents.on("achievement-earned", (achievement) => {
      const toast: Toast = {
        id: nextId++,
        icon: achievement.icon,
        title: achievement.title,
        who: achievement.subjectName,
        description: achievement.description,
      };
      setToasts((current) => [...current, toast]);
      setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== toast.id));
      }, VISIBLE_MS);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        left: "50%",
        transform: "translateX(-50%)",
        display: "grid",
        gap: 6,
        zIndex: 35,
        pointerEvents: "none",
      }}
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pixel-panel"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            borderColor: "var(--pixel-yellow, #e8b44a)",
            minWidth: 260,
          }}
        >
          <span style={{ fontSize: "18px" }}>{toast.icon}</span>
          <span>
            <span style={{ fontSize: "9px", display: "block" }}>
              {toast.who} — {toast.title}
            </span>
            <span style={{ fontSize: "8px", color: "var(--pixel-muted)" }}>
              {toast.description}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
