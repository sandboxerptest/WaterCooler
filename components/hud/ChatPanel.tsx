"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Mic, SendHorizontal } from "lucide-react";
import { useStudio } from "@/lib/store";
import { useSpeechInput } from "@/lib/hooks/useSpeechInput";
import { gameEvents } from "@/lib/events";
import type { ChatMessage, SessionRecord, TaskItem } from "@/types/game";
import { findTask } from "@/lib/reducer";
import HudFlyout from "./HudFlyout";
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

  const speech = useSpeechInput();
  const listening = speech.status === "listening";

  // Push-to-talk: hold the mic, speak, release. The transcript lands in the
  // input for review rather than being sent, so a mis-hearing never becomes an
  // agent run on its own.
  const startTalking = () => {
    if (!isConnected || !speech.supported) return;
    speech.start();
  };

  const stopTalking = () => {
    if (!listening) return;
    const text = speech.stop();
    if (!text) return;
    setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const micTitle = !speech.supported
    ? "Speech recognition needs Chrome or Safari"
    : speech.error === "not-allowed"
      ? "Microphone permission was denied"
      : listening
        ? "Listening — release to insert"
        : "Hold to talk";

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || !isConnected) return;
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

        {listening && (
          <div
            style={{
              fontSize: "8px",
              color: "var(--pixel-muted)",
              padding: "2px 4px",
              minHeight: 12,
            }}
          >
            🎙 {speech.transcript || "Listening…"}
          </div>
        )}

        <div className="hud-chat-input-row">
          <textarea
            ref={inputRef}
            className="pixel-input"
            style={{ flex: 1, minHeight: 40, height: 40, resize: "none", padding: "8px 10px" }}
            placeholder={isConnected ? "Type a message..." : "Connect first..."}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isConnected}
          />
          <button
            type="button"
            className="pixel-icon-btn"
            style={{
              width: 40,
              height: 40,
              minWidth: 40,
              minHeight: 40,
              color: listening ? "var(--pixel-red)" : undefined,
            }}
            onPointerDown={startTalking}
            onPointerUp={stopTalking}
            onPointerLeave={stopTalking}
            onPointerCancel={stopTalking}
            disabled={!isConnected || !speech.supported}
            title={micTitle}
            aria-label={micTitle}
            aria-pressed={listening}
          >
            <Mic size={16} />
          </button>
          <button
            type="button"
            className="pixel-icon-btn pixel-icon-btn--primary"
            style={{ width: 40, height: 40, minWidth: 40, minHeight: 40 }}
            onClick={handleSend}
            disabled={!isConnected || !input.trim()}
            title="Send"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </HudFlyout>
  );
}
