"use client";

import type { TaskItem } from "@/types/game";
import { formatRelativeTime } from "@/lib/constants";
import HudFlyout from "./HudFlyout";

function taskStatusLabel(status: TaskItem["status"]) {
  switch (status) {
    case "queued":
      return "queued";
    case "returning":
      return "returning";
    case "submitted":
      return "sending";
    case "stopped":
      return "stopped";
    default:
      return status;
  }
}

const BUSY = ["running", "submitted", "queued", "returning"];

/**
 * The list itself, without a panel around it.
 *
 * Tasks are shown in two places — a flyout over the office and a tab in the
 * column beside it — and only the frame around them differs.
 */
export function TaskList({ tasks }: { tasks: TaskItem[] }) {
  return (
    <div className="hud-list">
      {tasks.length === 0 ? (
        <div className="hud-empty">No tasks yet.</div>
      ) : (
        tasks.map((task) => (
          <div key={task.taskId} className="hud-list__item">
            <div className="hud-list__top">
              <span className={`hud-status hud-status--${task.status}`}>
                {taskStatusLabel(task.status)}
              </span>
              <span>{formatRelativeTime(task.completedAt ?? task.createdAt)}</span>
            </div>
            <div className="hud-list__title">{task.message}</div>
          </div>
        ))
      )}
    </div>
  );
}

export default function TaskPanel({ tasks }: { tasks: TaskItem[] }) {
  const runningTasks = tasks.filter((task) => BUSY.includes(task.status));

  return (
    <HudFlyout title="Tasks" subtitle={`${runningTasks.length} active / ${tasks.length} total`}>
      <TaskList tasks={tasks} />
    </HudFlyout>
  );
}
