"use client";

import "./character-studio.css";
import "./world-ui.css";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpDown, X } from "lucide-react";
import { gameEvents } from "@/lib/events";
import { focusableIn, nextFocusIndex, useGamepadFocus } from "@/lib/hooks/useGamepadFocus";
import { fetchPeople } from "@/lib/people-client";
import { addressFromLocation, elevatorStops, type Occupant } from "@/lib/world/floors";

/**
 * The lift's buttons.
 *
 * Opens when the person steps into the lift. Every floor is a page of its
 * own, so choosing one is a navigation. It is a menu for the keys as much
 * as the mouse: up and down (or W and S, or the stick) move between the
 * floors, Enter, Space or E goes, Escape (or B) closes.
 */
export default function ElevatorModal() {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Occupant[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => gameEvents.on("open-elevator", () => setOpen(true)), []);

  // The pad walks the buttons the same way it does in every other dialog.
  useGamepadFocus(panelRef, open);

  const close = () => {
    setOpen(false);
    gameEvents.emit("elevator-closed");
  };

  // First focus lands on the nearest floor that is not this one.
  useEffect(() => {
    if (!open) return;
    const buttons = panelRef.current ? focusableIn(panelRef.current) : [];
    (buttons.find((b) => b.classList.contains("lift-stop")) ?? buttons[0])?.focus();
  }, [open, people]);

  // Who has a desk upstairs, fetched each time the doors open.
  useEffect(() => {
    if (!open) return;
    const address = addressFromLocation(window.location);
    if (!address) return;
    let live = true;
    void fetchPeople(address.tenant.slug).then((found) => {
      if (live) setPeople(found);
    });
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // You walk into the lift holding a direction, and the browser repeats
    // that key while it is held. The menu ignores every movement key until
    // one has been let go, and then takes one step per press, not per repeat.
    let armed = false;
    const isMove = (key: string) => ["ArrowUp", "ArrowDown", "w", "W", "s", "S"].includes(key);
    const onKeyUp = (e: KeyboardEvent) => {
      if (isMove(e.key)) armed = true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      const stops = focusableIn(panel).filter((b) => b.classList.contains("lift-stop"));
      const current = stops.findIndex((b) => b === document.activeElement);
      const delta =
        e.key === "ArrowUp" || e.key === "w" || e.key === "W"
          ? -1
          : e.key === "ArrowDown" || e.key === "s" || e.key === "S"
            ? 1
            : 0;
      if (delta) {
        e.preventDefault();
        if (!armed || e.repeat) return;
        stops[nextFocusIndex(current, delta, stops.length)]?.focus();
        return;
      }
      const go = e.key === "Enter" || e.key === " " || e.key === "e" || e.key === "E";
      if (go && current >= 0) {
        e.preventDefault();
        stops[current].click();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [open]);

  if (!open) return null;

  const address = addressFromLocation(window.location);
  // Only where you can go: the floor you are on is not a destination.
  const stops = address ? elevatorStops(address, { people }).filter((s) => !s.here) : [];

  return createPortal(
    <div className="studio-overlay" onClick={close}>
      <div
        className="lift"
        role="dialog"
        aria-label="Elevator"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio__header">
          <h2 className="studio__title">
            <ArrowUpDown size={14} aria-hidden /> Elevator
          </h2>
          <button className="studio__close" onClick={close} aria-label="Close">
            <X size={14} />
          </button>
        </header>
        {address ? (
          <div className="lift__stops">
            {stops.map((stop) => (
              <button
                key={stop.label}
                type="button"
                className="lift-stop"
                onClick={() => window.location.assign(stop.url)}
              >
                <span className="lift-stop__floor">
                  <span>{stop.label}</span>
                  {stop.names.length > 0 && (
                    <span className="lift-stop__names">{stop.names.join(" · ")}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="welcome__lead">This lift only runs inside a building.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
