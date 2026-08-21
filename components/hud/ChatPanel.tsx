"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SendHorizontal } from "lucide-react";
import { useStudio } from "@/lib/store";
import MicButton from "./MicButton";
import { gameEvents } from "@/lib/events";
import type { ChatMessage, SessionRecord, TaskItem } from "@/types/game";
import { findTask } from "@/lib/reducer";
import HudFlyout from "./HudFlyout";
import { say } from "@/lib/room-speech";
import MessageBubble from "./MessageBubble";
import SessionSwitcher from "./SessionSwitcher";

export default function ChatPanel({
  messages,
  tasks,
  isConnected,
  sessions,
  activeSessionKey,
}: {
  messages: ChatMessage[];
  tasks: TaskItem[];
  isConnected: boolean;
  sessions: SessionRecord[];
  activeSessionKey?: string;
}) {
  const { assignTask } = useStudio();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const actorByRunId = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) {
      if (!task.actorName) continue;
      if (task.runId) map.set(task.runId, task.actorName);
      map.set(task.taskId, task.actorName);
    }
    return map;
  }, [tasks]);

  const stopHandler = useCallback((runId: string, seatId: string) => {
    gameEvents.emit("stop-task", runId, seatId);
  }, []);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  useEffect(() => {
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    }
  }, [messages.length, virtualizer]);

  // Whether the box gives work to an agent or says something to the room
  const [mode, setMode] = useState<"task" | "say">("task");
  const [scope, setScope] = useState<"room" | "nearby">("room");

  const appendDictation = (text: string) => {
    setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (mode === "say") {
      // Talking to the people in the room, not to an agent — this works even
      // when the agent bridge is down, because it needs nobody's API key
      say(trimmed, scope);
      setInput("");
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    if (!isConnected) return;
    assignTask(trimmed);
    setInput("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <HudFlyout
      title="Chat"
      subtitle={isConnected ? "Send messages and view execution" : "Connect to start"}
      headerAction={<SessionSwitcher sessions={sessions} activeKey={activeSessionKey} />}
      bodyClass="hud-flyout__body--chat"
    >
      <div className="hud-chat-layout">
        <div ref={scrollRef} className="hud-chat">
          {messages.length === 0 ? (
            <div className="hud-empty">No conversation yet. Type a message to begin.</div>
          ) : (
            <div
              style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const message = messages[virtualRow.index];
                const task = findTask(tasks, message.runId);
                const canStop = task?.status === "running" && (task.runId ?? task.taskId);
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div style={{ paddingBottom: 8 }}>
                      <MessageBubble
                        msg={message}
                        actorName={actorByRunId.get(message.runId)}
                        canStop={!!canStop}
                        onStop={
                          canStop
                            ? () => stopHandler(task.runId ?? task.taskId, task.seatId ?? "")
                            : undefined
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "0 2px 6px" }}>
          {(["task", "say"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`pixel-button ${mode === option ? "pixel-button--primary" : ""}`}
              style={{ fontSize: "8px", padding: "2px 8px" }}
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              title={
                option === "task"
                  ? "Give this to an agent"
                  : "Say it out loud to the people in the room"
              }
            >
              {option === "task" ? "Assign" : "Say"}
            </button>
          ))}
          {mode === "say" && (
            <button
              type="button"
              className="pixel-button"
              style={{ fontSize: "8px", padding: "2px 8px", marginLeft: "auto" }}
              onClick={() => setScope((prev) => (prev === "room" ? "nearby" : "room"))}
              title={
                scope === "room"
                  ? "Everyone in the room hears this"
                  : "Only people standing near you hear this"
              }
            >
              {scope === "room" ? "whole room" : "nearby only"}
            </button>
          )}
        </div>

        <div className="hud-chat-input-row">
          <textarea
            ref={inputRef}
            className="pixel-input"
            style={{ flex: 1, minHeight: 40, height: 40, resize: "none", padding: "8px 10px" }}
            placeholder={
              mode === "say"
                ? "Say something to the room..."
                : isConnected
                  ? "Type a message..."
                  : "Connect first..."
            }
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={mode === "task" && !isConnected}
          />
          <MicButton
            onTranscript={appendDictation}
            disabled={mode === "task" && !isConnected}
            what={mode === "say" ? "remark" : "message"}
          />
          <button
            type="button"
            className="pixel-icon-btn pixel-icon-btn--primary"
            style={{ width: 40, height: 40, minWidth: 40, minHeight: 40 }}
            onClick={handleSend}
            disabled={(mode === "task" && !isConnected) || !input.trim()}
            title={mode === "say" ? "Say it" : "Send"}
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </HudFlyout>
  );
}
