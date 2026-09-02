"use client";

import { useEffect, useState, type RefObject } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

/** On the overlay while the game fills the window. */
export const FILL_CLASS = "game-fullwindow";

interface FullscreenTarget extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface FullscreenDocument extends Document {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
}

function nativeElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export interface FullscreenControl {
  on: boolean;
  toggle: () => void;
}

/**
 * Takes a game panel to the whole screen and back.
 *
 * The overlay fills the window the moment it is asked — that much every
 * browser allows — and the browser's own fullscreen is asked for on top,
 * which hides its chrome where it is permitted. The request's promise is
 * not waited on: some browsers leave it hanging, and the game should be big
 * either way. A controller button is not a "user gesture" to the browser,
 * so from the pad it is the window fill that you get.
 */
export function useFullscreen(target: RefObject<HTMLElement | null>): FullscreenControl {
  const [on, setOn] = useState(false);

  // Escape, or the browser's own control, leaves native fullscreen; when
  // that happens the game comes back to its panel too.
  useEffect(() => {
    const onChange = () => {
      if (!nativeElement()) {
        target.current?.classList.remove(FILL_CLASS);
        setOn(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      target.current?.classList.remove(FILL_CLASS);
    };
  }, [target]);

  const toggle = () => {
    const el = target.current as FullscreenTarget | null;
    if (!el) return;
    const doc = document as FullscreenDocument;
    if (el.classList.contains(FILL_CLASS)) {
      el.classList.remove(FILL_CLASS);
      setOn(false);
      if (nativeElement() === el) {
        void Promise.resolve(
          doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.(),
        ).catch(() => {});
      }
      return;
    }
    el.classList.add(FILL_CLASS);
    setOn(true);
    const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (request) {
      try {
        void Promise.resolve(request.call(el)).catch(() => {});
      } catch {
        // Refused outright; the window fill is already in place.
      }
    }
  };

  return { on, toggle };
}

export default function FullscreenButton({
  control,
  what,
}: {
  control: FullscreenControl;
  what: string;
}) {
  return (
    <button
      type="button"
      className="pixel-icon-btn"
      style={{ width: 28, height: 28 }}
      onClick={control.toggle}
      title={control.on ? "Back to the room" : "Full screen"}
      aria-label={control.on ? `Leave full screen ${what}` : `Play ${what} full screen`}
      aria-pressed={control.on}
    >
      {control.on ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
    </button>
  );
}
