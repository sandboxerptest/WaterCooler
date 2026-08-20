"use client";

import { Mic } from "lucide-react";
import { useSpeechInput } from "@/lib/hooks/useSpeechInput";

interface MicButtonProps {
  /** Called on release with everything recognised while held. Never called with empty text. */
  onTranscript: (text: string) => void;
  disabled?: boolean;
  /** Square button size in px. */
  size?: number;
  /** What is being dictated, for the tooltip: "Hold to talk" → "Hold to dictate the task". */
  what?: string;
}

/**
 * Push-to-talk button.
 *
 * Hold it (pointer, or Space/Enter when focused), speak, release — the
 * transcript goes to `onTranscript` for the caller to put in its own field.
 * Nothing is ever sent on the user's behalf: a mis-hearing lands as editable
 * text, not as an agent run.
 */
export default function MicButton({ onTranscript, disabled, size = 40, what }: MicButtonProps) {
  const speech = useSpeechInput();
  const listening = speech.status === "listening";
  const unavailable = disabled || !speech.supported;

  const start = () => {
    if (unavailable) return;
    speech.start();
  };

  const finish = () => {
    if (!listening) return;
    const text = speech.stop();
    if (text) onTranscript(text);
  };

  const title = !speech.supported
    ? "Speech recognition needs Chrome or Safari"
    : speech.error === "not-allowed"
      ? "Microphone permission was denied"
      : listening
        ? "Listening — release to insert"
        : what
          ? `Hold to dictate the ${what}`
          : "Hold to talk";

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      {listening && (
        <span
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            right: 0,
            whiteSpace: "nowrap",
            maxWidth: 260,
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: "8px",
            lineHeight: 1.4,
            padding: "3px 6px",
            borderRadius: "var(--pixel-radius-sm)",
            background: "var(--pixel-panel, rgba(0,0,0,0.85))",
            color: "var(--pixel-text, #fff)",
            border: "1px solid var(--pixel-red)",
            pointerEvents: "none",
            zIndex: 30,
          }}
        >
          🎙 {speech.transcript || "Listening…"}
        </span>
      )}
      <button
        type="button"
        className="pixel-icon-btn"
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          color: listening ? "var(--pixel-red)" : undefined,
        }}
        onPointerDown={start}
        onPointerUp={finish}
        onPointerLeave={finish}
        onPointerCancel={finish}
        onKeyDown={(event) => {
          // Hold-to-talk from the keyboard; ignore auto-repeat while held
          if ((event.key === " " || event.key === "Enter") && !event.repeat) {
            event.preventDefault();
            start();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            finish();
          }
        }}
        onBlur={finish}
        disabled={unavailable}
        title={title}
        aria-label={title}
        aria-pressed={listening}
      >
        <Mic size={Math.round(size * 0.4)} />
      </button>
    </span>
  );
}
