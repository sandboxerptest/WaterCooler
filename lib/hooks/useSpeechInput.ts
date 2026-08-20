"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SpeechSession, type SpeechRecognitionLike } from "../speech-session";
import { createLogger } from "../logger";

const log = createLogger("Speech");

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type SpeechStatus = "unsupported" | "idle" | "listening" | "error";

/** Turn an API error code into something a person can act on. */
function errorHint(error: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Mic blocked — allow access";
    case "no-speech":
      return "Didn't catch that";
    case "audio-capture":
      return "No microphone found";
    case "network":
      return "Speech service unreachable";
    case "aborted":
      return "Cancelled";
    default:
      return error;
  }
}

export interface SpeechInput {
  status: SpeechStatus;
  /** Text recognised so far this utterance, for a live preview. */
  transcript: string;
  /** Last error code, e.g. "not-allowed" when the mic is blocked. */
  error: string | null;
  /** A short, human-readable reason the last attempt produced nothing, if any. */
  hint: string | null;
  supported: boolean;
  start: () => void;
  /**
   * Ask recognition to stop. The transcript is delivered to the hook's
   * onResult callback once the engine flushes — not synchronously here.
   */
  stop: () => void;
}

/** Capability is a client-only fact, so it must not be read during SSR. */
const subscribeToNothing = () => () => {};
const readSupport = () => getRecognitionCtor() !== null;
const supportedOnServer = () => false;

/**
 * Push-to-talk speech recognition.
 *
 * @param onResult receives the finished transcript. Callers put it in their own
 * field for review — nothing is submitted on the user's behalf, so a
 * mis-hearing never becomes an agent run.
 */
export function useSpeechInput(onResult: (text: string) => void): SpeechInput {
  // Rendering the server snapshot (false) during hydration keeps the markup
  // identical on both sides; the real value lands right after.
  const supported = useSyncExternalStore(subscribeToNothing, readSupport, supportedOnServer);

  const [rawStatus, setStatus] = useState<SpeechStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const sessionRef = useRef<SpeechSession | null>(null);
  // Held in a ref so a re-rendered callback still reaches an in-flight session
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const status: SpeechStatus = supported ? rawStatus : "unsupported";

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    if (sessionRef.current?.listening) return;

    setTranscript("");
    setError(null);
    setHint(null);

    const session = new SpeechSession(
      () => {
        const recognition = new Ctor();
        recognition.lang = navigator.language || "en-US";
        return recognition;
      },
      {
        onInterim: setTranscript,
        onResult: (text) => {
          setTranscript("");
          onResultRef.current(text);
        },
        onNoSpeech: () => {
          setTranscript("");
          setHint("Didn't catch that");
        },
        onError: (err) => {
          log.warn("recognition error:", err);
          setError(err);
          setHint(errorHint(err));
          setStatus("error");
        },
        onStateChange: (listening) => {
          setStatus((prev) => {
            if (listening) return "listening";
            return prev === "error" ? prev : "idle";
          });
        },
      },
    );

    sessionRef.current = session;
    session.start();
  }, []);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current?.abort();
      sessionRef.current = null;
    };
  }, []);

  return { status, transcript, error, hint, supported, start, stop };
}
