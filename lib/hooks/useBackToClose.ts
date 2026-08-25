"use client";

import { useEffect, useRef } from "react";

/**
 * Let the back button close a panel instead of leaving the app.
 *
 * On a phone the chat column is a drawer over the office, and the obvious way
 * to dismiss anything covering the screen is the back button — which, with
 * nothing done about it, walks out of the app altogether and loses the room.
 *
 * The trick is an extra history entry while the panel is open: back consumes
 * that instead of the page. If the panel is closed some other way the entry
 * is taken off again, or the next back press would appear to do nothing.
 */
export function useBackToClose(active: boolean, onClose: () => void): void {
  const ourEntry = useRef(false);

  useEffect(() => {
    if (!active) return;

    window.history.pushState({ watercoolerPanel: true }, "");
    ourEntry.current = true;

    const onPopState = () => {
      // The browser has taken our entry back; nothing left to clean up
      ourEntry.current = false;
      onClose();
    };

    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      if (!ourEntry.current) return;
      ourEntry.current = false;
      // Closed by a button rather than by going back: drop the entry, so the
      // next back press means what it says
      window.history.back();
    };
  }, [active, onClose]);
}
