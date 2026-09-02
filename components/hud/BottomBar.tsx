"use client";

import { useEffect, useState } from "react";
import { CircleDollarSign, Gamepad2, Mic, MicOff, Sparkles, User, Users } from "lucide-react";
import { gameEvents } from "@/lib/events";
import { useVoice } from "@/lib/hooks/useVoice";
import { voiceChat } from "@/lib/voice/voice-chat";
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

  const [pad, setPad] = useState<{ id: string; layout: string } | null>(null);

  useEffect(() => {
    return gameEvents.on("gamepad-state", (id, layout) => {
      setPad(id ? { id, layout } : null);
    });
  }, []);

  const voice = useVoice();
  const micOn = voice.status === "on";
  const micTitle =
    voice.status === "on"
      ? voice.peers
        ? `Microphone on — ${voice.inEarshot} of ${voice.peers} on voice within earshot. Click to switch off.`
        : "Microphone on — nobody else here is on voice yet. Click to switch off."
      : voice.status === "requesting"
        ? "Asking for the microphone…"
        : (voice.reason ??
          "Switch on voice chat: people near you in the room will hear you. On a controller, hold LT to talk.");

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
      <button
        type="button"
        className={`hud-pill hud-pill--metric hud-pill--button hud-mic${micOn ? " hud-mic--on" : ""}${
          voice.speaking ? " hud-mic--speaking" : ""
        }${voice.status === "denied" || voice.status === "unsupported" ? " hud-mic--blocked" : ""}`}
        onClick={() => void voiceChat.toggle()}
        title={micTitle}
        aria-pressed={micOn}
        aria-label={micOn ? "Switch voice chat off" : "Switch voice chat on"}
      >
        {micOn ? <Mic size={10} /> : <MicOff size={10} />}
        <span>
          {voice.status === "requesting"
            ? "mic…"
            : micOn
              ? `voice ${voice.inEarshot}/${voice.peers}`
              : "voice off"}
        </span>
      </button>
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
      {pad && (
        <div
          className="hud-pill hud-pill--metric"
          title={`${pad.id}\nXbox layout: stick or d-pad walks · A talks to people and presses buttons · B backs out · LB RB turn the panels · View closes · hold LT to talk`}
        >
          <Gamepad2 size={10} />
          <span>{pad.layout} · hold LT to talk</span>
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
