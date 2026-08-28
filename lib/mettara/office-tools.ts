/**
 * The tools a Mettara AI can call back into the office with.
 *
 * Registered at startup and reached over the signed inbound webhook. Keep this
 * small and boring: everything here is callable from outside the process, so
 * each handler validates its own arguments rather than trusting the caller.
 */

import { ToolRegistry, type ToolRequest } from "./webhook";

export interface OfficeToolDeps {
  listWorkers(room: string): Array<{ seatId: string; label: string; roleTitle?: string }>;
  dispatch(seatId: string, task: string, room: string): Promise<{ result: string; error?: string }>;
  defaultRoom: string;
}

function roomOf(req: ToolRequest, fallback: string): string {
  const room = req.arguments.room;
  return typeof room === "string" && room.trim() ? room.trim() : fallback;
}

export function buildOfficeTools(deps: OfficeToolDeps): ToolRegistry {
  return new ToolRegistry()
    .register("list_workers", (req) => ({
      workers: deps.listWorkers(roomOf(req, deps.defaultRoom)),
    }))
    .register("dispatch_task", async (req) => {
      const seatId = req.arguments.seatId;
      const task = req.arguments.task;
      if (typeof seatId !== "string" || !seatId) throw new Error("seatId is required");
      if (typeof task !== "string" || !task.trim()) throw new Error("task is required");

      const outcome = await deps.dispatch(seatId, task, roomOf(req, deps.defaultRoom));
      // A refusal is the tool's answer, not a transport failure — hand it back
      // as data so the AI can tell the room why the work did not happen.
      if (outcome.error) throw new Error(outcome.error);
      return { result: outcome.result };
    });
}
