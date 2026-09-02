"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { XBOX, buttonLabel } from "@/lib/gamepad/buttons";
import {
  DEFAULT_TALK_BUTTON,
  resetTalkButton,
  setTalkButton,
  subscribeTalkButton,
  talkButton,
} from "@/lib/gamepad/bindings";
import { padMonitor } from "@/lib/gamepad/monitor";
import PadLegend from "./PadLegend";

/** What the browser reports, read straight from the Gamepad API. */
interface Report {
  pads: { id: string; mapping: string; buttons: number; axes: number; held: number[] }[];
  api: boolean;
  secure: boolean;
  framed: boolean;
  activated: boolean | null;
  allowed: boolean | null;
}

interface FeaturePolicyDocument extends Document {
  featurePolicy?: { allowsFeature(name: string): boolean };
}

function readReport(): Report {
  const nav = navigator;
  const doc = document as FeaturePolicyDocument;
  const api = typeof nav.getGamepads === "function";
  const list = api ? (nav.getGamepads() as unknown as (Gamepad | null)[]) : [];
  return {
    api,
    secure: window.isSecureContext,
    framed: window.top !== window,
    activated: "userActivation" in nav ? nav.userActivation.hasBeenActive : null,
    allowed: doc.featurePolicy ? doc.featurePolicy.allowsFeature("gamepad") : null,
    pads: list
      .filter((pad): pad is Gamepad => !!pad && pad.connected)
      .map((pad) => ({
        id: pad.id,
        mapping: pad.mapping || "(none)",
        buttons: pad.buttons.length,
        axes: pad.axes.length,
        held: pad.buttons.flatMap((button, index) => (button.pressed ? [index] : [])),
      })),
  };
}

/**
 * The controller check: what the browser sees, live, and what to do when
 * it sees nothing. Opens from the controller pill in the bottom bar, so
 * "is it even detected?" has an answer on screen rather than a guess.
 */
export default function ControllerCheck({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [lastPress, setLastPress] = useState<string | null>(null);
  /** Waiting for the person to press the button they want to talk with. */
  const [choosing, setChoosing] = useState(false);
  const talk = useSyncExternalStore(subscribeTalkButton, talkButton, talkButton);

  // The next button down while choosing becomes the talk button. The
  // d-pad, A and B are spoken for everywhere, so those are not offered.
  useEffect(() => {
    if (!choosing) return;
    return padMonitor.subscribe((event) => {
      if (event.phase !== "down") return;
      const taken = [XBOX.A, XBOX.B, XBOX.UP, XBOX.DOWN, XBOX.LEFT, XBOX.RIGHT];
      if (taken.includes(event.button as (typeof taken)[number])) return;
      setTalkButton(event.button);
      setChoosing(false);
    });
  }, [choosing]);

  useEffect(() => {
    const tick = () => {
      const next = readReport();
      setReport(next);
      const held = next.pads[0]?.held ?? [];
      if (held.length > 0) setLastPress(held.map(buttonLabel).join(" + "));
    };
    tick();
    const timer = window.setInterval(tick, 200);
    const stamp = () => new Date().toLocaleTimeString();
    const onConnect = (event: GamepadEvent) =>
      setEvents((prev) => [`${stamp()} connected: ${event.gamepad.id}`, ...prev].slice(0, 6));
    const onDisconnect = (event: GamepadEvent) =>
      setEvents((prev) => [`${stamp()} disconnected: ${event.gamepad.id}`, ...prev].slice(0, 6));
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const seen = report?.pads.length ?? 0;
  const first = report?.pads[0];

  return (
    <div className="studio-overlay" onClick={onClose}>
      <div
        className="pixel-panel controller-check"
        role="dialog"
        aria-label="Controller check"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="controller-check__head">
          <span>Controller check</span>
          <button
            type="button"
            className="pixel-icon-btn"
            style={{ width: 26, height: 26 }}
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close the controller check"
          >
            <X size={12} />
          </button>
        </div>

        <div className={`controller-check__status${seen ? " controller-check__status--on" : ""}`}>
          {seen ? `Controller found: ${first?.id}` : "No controller seen by the browser yet."}
        </div>

        {seen && first ? (
          <div className="controller-check__facts">
            <div>
              Mapping: {first.mapping === "standard" ? "standard (Xbox layout)" : first.mapping}
            </div>
            <div>
              {first.buttons} buttons · {first.axes} axes
            </div>
            <div>
              Held now: {first.held.length ? first.held.map(buttonLabel).join(" + ") : "nothing"}
            </div>
            <div>Last press: {lastPress ?? "press a button to see its name"}</div>
            {first.buttons === 0 && (
              <div>This pad reports no buttons, so nothing here can read it.</div>
            )}
            {first.mapping !== "standard" && (
              <div>
                Without the standard mapping the browser numbers the buttons its own way, so the
                names below may not line up.
              </div>
            )}
          </div>
        ) : (
          <div className="controller-check__facts">
            <div>Click anywhere on the page once, then press A on the pad.</div>
            <div>
              Browsers keep a controller hidden until the page has been clicked and a button has
              been pressed — moving a stick is not enough.
            </div>
            <div>
              Make sure the pad is paired to this computer (it shows in Bluetooth or USB) and that
              no other app has taken it.
            </div>
          </div>
        )}

        <div className="controller-check__facts controller-check__facts--dim">
          <div>Gamepad API: {report ? (report.api ? "yes" : "missing") : "…"}</div>
          <div>
            Allowed here:{" "}
            {report ? (report.allowed === null ? "unknown" : report.allowed ? "yes" : "no") : "…"}
          </div>
          <div>
            Page clicked yet:{" "}
            {report?.activated === null ? "unknown" : report?.activated ? "yes" : "no"}
          </div>
          <div>Secure page: {report ? (report.secure ? "yes" : "no") : "…"}</div>
          <div>Inside a frame: {report ? (report.framed ? "yes" : "no") : "…"}</div>
          {events.length > 0 ? (
            events.map((line) => <div key={line}>{line}</div>)
          ) : (
            <div>No connect events heard yet.</div>
          )}
        </div>

        <div className="controller-check__facts">
          <div>
            Hold to talk: <kbd className="pad-key">{buttonLabel(talk)}</kbd>{" "}
            {choosing ? (
              <span style={{ color: "var(--pixel-accent)" }}>
                press the button you want to talk with…
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="pixel-button"
                  style={{ fontSize: "8px", padding: "2px 6px" }}
                  onClick={() => setChoosing(true)}
                  disabled={!seen}
                  title={
                    seen
                      ? "Press a button on the pad to make it the talk button"
                      : "Plug in a controller first"
                  }
                >
                  Change
                </button>{" "}
                {talk !== DEFAULT_TALK_BUTTON && (
                  <button
                    type="button"
                    className="pixel-button"
                    style={{ fontSize: "8px", padding: "2px 6px" }}
                    onClick={() => resetTalkButton()}
                  >
                    Back to {buttonLabel(DEFAULT_TALK_BUTTON)}
                  </button>
                )}
              </>
            )}
          </div>
          <div style={{ color: "var(--pixel-muted)", fontSize: "8px" }}>
            Some pads report a bumper where the trigger should be; if the wrong button talks, pick
            the one you want here and it is remembered in this browser.
          </div>
        </div>

        <PadLegend
          entries={[
            ["act", "act / talk to someone"],
            ["back", "back"],
            ["fullscreen", "full screen"],
            ["mute", "music"],
            ["close", "close"],
            ["restart", "again"],
            ["talk", "hold to talk"],
          ]}
        />
        <div className="controller-check__facts controller-check__facts--dim">
          <div>
            {buttonLabel(XBOX.LB)} {buttonLabel(XBOX.RB)} turn the HUD panels · stick or d-pad walks
            and moves through dialogs
          </div>
        </div>
      </div>
    </div>
  );
}
