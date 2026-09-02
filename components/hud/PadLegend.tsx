"use client";

import { Gamepad2 } from "lucide-react";
import { MACHINE_BUTTONS, buttonLabel, type MachineAction } from "@/lib/gamepad/buttons";

/** One line of the legend: the action, and what it means on this machine. */
export type LegendEntry = [action: MachineAction, what: string];

/**
 * The controller's buttons, printed on the machine in Xbox colours so the
 * bindings are documented where they are used. Which button does what
 * comes from MACHINE_BUTTONS, so the legend cannot drift from the code.
 */
export default function PadLegend({ entries }: { entries: LegendEntry[] }) {
  return (
    <div className="pad-legend" aria-label="Controller buttons">
      <Gamepad2 size={9} aria-hidden="true" />
      {entries.map(([action, what]) => {
        const label = buttonLabel(MACHINE_BUTTONS[action]);
        return (
          <span key={action} className="pad-legend__item">
            <kbd className={`pad-key pad-key--${label.toLowerCase()}`}>{label}</kbd>
            {what}
          </span>
        );
      })}
    </div>
  );
}
