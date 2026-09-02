"use client";

import { useEffect, useRef, type RefObject } from "react";
import { XBOX, machineAction } from "@/lib/gamepad/buttons";
import { talkButton } from "@/lib/gamepad/bindings";
import { padMonitor } from "@/lib/gamepad/monitor";
import { confirmFocused, moveFocus } from "@/lib/gamepad/focus";

/**
 * What a game machine does with each controller button. The bindings are
 * the same on every machine — see MACHINE_BUTTONS — so a player who has
 * learned one has learned them all; a machine leaves out what it has no use
 * for (the ping pong table has no music to mute).
 */
export interface MachinePadHandlers {
  /** A, when the machine is showing a menu rather than a game. */
  act?: () => void;
  /** B: one step out. Falls back to close where there is nothing to go back to. */
  back?: () => void;
  /** View: leave the machine from anywhere. */
  close: () => void;
  /** X: fill the screen, or come back from it. */
  fullscreen: () => void;
  /** Y: the music off and on. */
  mute?: () => void;
  /** Menu: play again, or a new deal. */
  restart?: () => void;
  up?: () => void;
  down?: () => void;
  left?: () => void;
  right?: () => void;
  /**
   * A menu made of ordinary buttons: the d-pad walks the focus ring through
   * it and A presses whatever the ring is on, so nothing needs a cursor of
   * its own. Only while `menuActive`.
   */
  menu?: RefObject<HTMLElement | null>;
  menuActive?: boolean;
}

/**
 * Read the controller for a game machine while it is open. The machine's
 * overlay should carry PAD_OWN_ATTR so the HUD's driver stays out of it.
 */
export function useMachinePad(open: boolean, handlers: MachinePadHandlers) {
  const current = useRef(handlers);
  useEffect(() => {
    current.current = handlers;
  });

  useEffect(() => {
    if (!open) return;
    return padMonitor.subscribe((event) => {
      const h = current.current;
      const menu = h.menuActive ? (h.menu?.current ?? null) : null;

      // The talk button is the HUD driver's, wherever it has been put.
      if (event.button === talkButton()) return;

      if (event.phase === "up") {
        if (event.button === XBOX.A && menu) confirmFocused(menu, "up");
        return;
      }

      switch (machineAction(event.button)) {
        case "act":
          if (menu) confirmFocused(menu, "down");
          else h.act?.();
          return;
        case "back":
          (h.back ?? h.close)();
          return;
        case "close":
          h.close();
          return;
        case "fullscreen":
          h.fullscreen();
          return;
        case "mute":
          h.mute?.();
          return;
        case "restart":
          h.restart?.();
          return;
        case "talk":
          // The HUD's driver has the trigger: talking works the same everywhere.
          return;
      }

      const backward = event.button === XBOX.UP || event.button === XBOX.LEFT;
      const forward = event.button === XBOX.DOWN || event.button === XBOX.RIGHT;
      if (menu) {
        if (backward) moveFocus(menu, -1);
        else if (forward) moveFocus(menu, 1);
        return;
      }
      if (event.button === XBOX.UP) h.up?.();
      else if (event.button === XBOX.DOWN) h.down?.();
      else if (event.button === XBOX.LEFT) h.left?.();
      else if (event.button === XBOX.RIGHT) h.right?.();
    });
  }, [open]);
}
