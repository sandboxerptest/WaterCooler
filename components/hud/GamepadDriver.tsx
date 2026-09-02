"use client";

import { useEffect } from "react";
import { gameEvents } from "@/lib/events";
import { HUD_BUTTONS, XBOX } from "@/lib/gamepad/buttons";
import { padMonitor } from "@/lib/gamepad/monitor";
import { PAD_OWN_ATTR, topDialog } from "@/lib/gamepad/dialogs";
import { confirmFocused, moveFocus } from "@/lib/gamepad/focus";
import { voiceChat } from "@/lib/voice/voice-chat";

/**
 * The controller, everywhere that is not a game machine.
 *
 * - Hold the left trigger to talk: the voice comes on as it goes down and
 *   off as it comes up, wherever you are and whatever is open.
 * - With a dialog up, the d-pad or stick walks its controls, A presses the
 *   one the ring is on, and B or View closes it. Every dialog in the game
 *   is marked `role="dialog"`, so a new one is covered without registering.
 * - The top-right flyout panels take the same walk while they are open.
 * - Otherwise the bumpers turn through the HUD's panels, View closes the
 *   open one, and B is Escape — every prompt in the game already closes on
 *   Escape, so the button becomes the key rather than each prompt learning
 *   about controllers.
 *
 * A game machine marks its overlay with PAD_OWN_ATTR and reads the pad
 * itself; only the trigger is heard here while one is open.
 */
export default function GamepadDriver() {
  useEffect(() => {
    let talking = false;

    const escape = () => {
      // One dispatch is enough: it bubbles document → window, so listeners
      // on either receive it exactly once.
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    const flyout = () => document.querySelector<HTMLElement>(".hud-topright-flyout");

    const unsubscribe = padMonitor.subscribe(({ button, phase }) => {
      if (button === HUD_BUTTONS.talk) {
        if (phase === "down") {
          talking = true;
          void voiceChat.enable();
        } else if (talking) {
          talking = false;
          void voiceChat.disable();
        }
        return;
      }

      const dialog = topDialog();
      if (dialog?.hasAttribute(PAD_OWN_ATTR)) return;

      if (phase === "down" && !dialog) {
        if (button === HUD_BUTTONS.prevPanel) {
          gameEvents.emit("hud-cycle-panel", -1);
          return;
        }
        if (button === HUD_BUTTONS.nextPanel) {
          gameEvents.emit("hud-cycle-panel", 1);
          return;
        }
      }

      const container = dialog ?? flyout();
      if (container) {
        if (phase === "up") {
          if (button === HUD_BUTTONS.confirm) confirmFocused(container, "up");
          return;
        }
        if (button === XBOX.UP || button === XBOX.LEFT) moveFocus(container, -1);
        else if (button === XBOX.DOWN || button === XBOX.RIGHT) moveFocus(container, 1);
        else if (button === HUD_BUTTONS.confirm) confirmFocused(container, "down");
        else if (button === HUD_BUTTONS.back) escape();
        else if (button === HUD_BUTTONS.closePanel) {
          escape();
          gameEvents.emit("hud-close-panel");
        }
        return;
      }

      if (phase !== "down") return;
      if (button === HUD_BUTTONS.closePanel) gameEvents.emit("hud-close-panel");
      else if (button === HUD_BUTTONS.back) escape();
    });

    return () => {
      unsubscribe();
      if (talking) void voiceChat.disable();
    };
  }, []);

  return null;
}
