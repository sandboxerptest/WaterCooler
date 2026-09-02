"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { gameEvents } from "@/lib/events";
import { addressFromLocation, describeFloor } from "@/lib/world/floors";
import { tenantTitle } from "@/lib/world/tenants";

import Image from "next/image";
import type { SeatState } from "@/types/game";
import type { HudPanelId, HudDockItem } from "./HudDock";
import CharacterPortrait from "./CharacterPortrait";
import AccountButton from "./AccountButton";

interface TopBarProps {
  seats: SeatState[];
  toolItems: HudDockItem[];
  openPanel: HudPanelId | null;
  onToggle: (id: HudPanelId) => void;
  iconOverrides?: Partial<Record<HudPanelId, string>>;
  onSeatClick?: (seatId: string) => void;
}

function seatDotColor(seat: SeatState): string {
  if (!seat.assigned) return "gray";
  if (seat.status === "running" || seat.status === "returning") return "yellow";
  if (seat.status === "failed") return "red";
  return "green";
}

/** The room never changes without a page load, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};
/** "Castle Atlantic · Lobby": the building and the floor, as a stable string. */
const readPlace = () => {
  const address = addressFromLocation(window.location);
  if (!address) return null;
  const floor = describeFloor(address);
  return floor ? `${tenantTitle(address.tenant)} · ${floor}` : tenantTitle(address.tenant);
};

export default function TopBar({
  seats,
  toolItems,
  openPanel,
  onToggle,
  iconOverrides,
  onSeatClick,
}: TopBarProps) {
  const roomPlace = useSyncExternalStore(noSubscribe, readPlace, () => null);
  // A scene that is not the room in the URL — the world map, a campus —
  // says where you are itself.
  const [scenePlace, setScenePlace] = useState<string | null>(null);
  useEffect(() => gameEvents.on("place-changed", (label) => setScenePlace(label)), []);
  const place = scenePlace ?? roomPlace;
  const assignedSeats = seats.filter((s) => s.assigned);

  return (
    <div className="layout-top">
      {/* Left: logo */}
      <div className="layout-topbar__title">
        <span className="layout-topbar__logo">WATERCOOLER</span>
        {place && <span className="hud-tenant">{place}</span>}
      </div>

      {/* Center: agent pills (each pill is its own floating element) */}
      <div className="layout-topbar__agents">
        {assignedSeats.map((seat) => (
          <button
            key={seat.seatId}
            type="button"
            className={`topbar-agent-pill ${
              seat.status === "running" || seat.status === "returning"
                ? "topbar-agent-pill--active"
                : ""
            }`}
            onClick={() => onSeatClick?.(seat.seatId)}
            title={`${seat.label} — ${seat.status}`}
          >
            <div className="topbar-agent-pill__avatar">
              <CharacterPortrait spritePath={seat.spritePath} name={seat.label} />
            </div>
            <span className="topbar-agent-pill__name">{seat.label}</span>
            <span className={`pixel-dot pixel-dot--${seatDotColor(seat)}`} />
          </button>
        ))}
      </div>

      {/* Right: tool buttons group */}
      <div className="layout-topbar__tools">
        {toolItems.map((item) => {
          const active = openPanel === item.id;
          const override = iconOverrides?.[item.id];
          const src = override ?? (active ? item.iconActive : item.icon);
          return (
            <button
              key={item.id}
              type="button"
              data-dock-id={item.id}
              onClick={() => onToggle(item.id)}
              title={item.label}
              className={`topbar-tool-btn ${active ? "topbar-tool-btn--active" : ""}`}
            >
              <Image
                src={src}
                alt={item.label}
                width={24}
                height={24}
                style={{ imageRendering: "pixelated", display: "block" }}
                unoptimized
              />
            </button>
          );
        })}
        <AccountButton />
      </div>
    </div>
  );
}
