"use client";

import { useEffect, useState } from "react";
import { CircleDollarSign, Sparkles, User, Users } from "lucide-react";
import { gameEvents } from "@/lib/events";
import { STATUS_LABELS, formatModelLabel } from "@/lib/constants";
import type { ConnectionStatus, SessionMetrics, SeatState } from "@/types/game";
import ContextMeter from "./ContextMeter";

interface BottomBarProps {
  connection: ConnectionStatus;
  sessionMetrics: SessionMetrics;
  seats: SeatState[];
}

export default function BottomBar({ connection, sessionMetrics, seats }: BottomBarProps) {
  // Humans in the room, which is separate from the agent seats beside it
  const [humans, setHumans] = useState<{ count: number; capacity: number } | null>(null);

  const [budget, setBudget] = useState<{ spent: number; limit: number; halted: boolean } | null>(
    null,
  );

  useEffect(() => {
    return gameEvents.on("presence-count", (count, capacity) => {
      setHumans({ count, capacity });
    });
  }, []);

  useEffect(() => {
    return gameEvents.on("budget-updated", (spentUsd, limitUsd, halted) => {
      setBudget({ spent: spentUsd, limit: limitUsd, halted });
    });
  }, []);

  const totalSeats = seats.length;
  const assignedSeats = seats.filter((s) => s.assigned).length;
  const workingCount = seats.filter(
    (s) => s.assigned && (s.status === "running" || s.status === "returning"),
  ).length;

  return (
    <div className="layout-bottombar">
      <div className="hud-pill hud-pill--connection">
        <span
          className={`pixel-dot pixel-dot--${
            connection === "connected" ? "green" : connection === "connecting" ? "yellow" : "red"
          }`}
        />
        <span>{STATUS_LABELS[connection]}</span>
      </div>
      <div className="hud-pill hud-pill--model">
        <Sparkles size={10} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {formatModelLabel(sessionMetrics.model)}
        </span>
      </div>
      <ContextMeter
        usedTokens={sessionMetrics.usedTokens}
        maxTokens={sessionMetrics.maxContextTokens}
        fresh={sessionMetrics.fresh}
        inline
      />
      <div className="hud-pill hud-pill--metric">
        <Users size={10} />
        <span>
          {assignedSeats}/{totalSeats} seat
        </span>
      </div>
      {humans && (
        <div
          className="hud-pill hud-pill--metric"
          title={`${humans.count} of ${humans.capacity} humans in this room`}
        >
          <User size={10} />
          <span>
            {humans.count}/{humans.capacity} here
          </span>
        </div>
      )}
      {budget && (
        <div
          className="hud-pill hud-pill--metric"
          title={
            budget.halted
              ? `This room has reached its $${budget.limit} limit and agents are paused`
              : `Spent $${budget.spent.toFixed(2)} of $${budget.limit} on agents in this room`
          }
          style={budget.halted ? { color: "var(--pixel-red)" } : undefined}
        >
          <CircleDollarSign size={10} />
          <span>
            {budget.spent.toFixed(2)}/{budget.limit}
          </span>
        </div>
      )}
      <div className="hud-pill hud-pill--metric">
        <Sparkles size={10} />
        <span>
          {workingCount}/{assignedSeats} busy
        </span>
      </div>
    </div>
  );
}
