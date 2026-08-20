"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createLogger } from "../logger";

const log = createLogger("Speech");

/**
 * Minimal shape of the Web Speech API we rely on. It is not in lib.dom, and
 * only Chrome/Safari ship it (behind the webkit prefix).
 */
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
  length: number;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResult;
  };
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
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

export interface SpeechInput {
  status: SpeechStatus;
  /** Text recognised so far this utterance, including the interim tail. */
  transcript: string;
  /** Last error code from the API, e.g. "not-allowed" when the mic is blocked. */
  error: string | null;
  supported: boolean;
  start: () => void;
  /** Stop listening and hand back everything recognised this utterance. */
  stop: () => string;
}

/**
 * Push-to-talk speech recognition.
 *
 * Recognition runs only while held, and the caller decides what to do with the
 * text — here it lands in the chat box for review rather than being sent, so a
 * mis-hearing never becomes an agent run on its own.
 */
/** Capability is a client-only fact, so it must not be read during SSR. */
const subscribeToNothing = () => () => {};
const readSupport = () => getRecognitionCtor() !== null;
const supportedOnServer = () => false;

export function useSpeechInput(): SpeechInput {
  // Rendering the server snapshot (false) during hydration keeps the mic
  // button's markup identical on both sides; the real value lands right after.
  const supported = useSyncExternalStore(subscribeToNothing, readSupport, supportedOnServer);

  const [rawStatus, setStatus] = useState<SpeechStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const interimRef = useRef("");

  const status: SpeechStatus = supported ? rawStatus : "unsupported";

  const stop = useCallback((): string => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    }
    const text = `${finalRef.current} ${interimRef.current}`.replace(/\s+/g, " ").trim();
    finalRef.current = "";
    interimRef.current = "";
    setTranscript("");
    setStatus((prev) => (prev === "error" ? prev : "idle"));
    return text;
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    if (recognitionRef.current) return;

    finalRef.current = "";
    interimRef.current = "";
    setTranscript("");
    setError(null);

    const recognition = new Ctor();
    recognition.lang = navigator.language || "en-US";
    // Keep listening through natural pauses; the user decides when to stop.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalRef.current += `${text} `;
        else interim += text;
      }
      interimRef.current = interim;
      setTranscript(`${finalRef.current}${interim}`.replace(/\s+/g, " ").trim());
    };

    recognition.onerror = (event) => {
      log.warn("recognition error:", event.error);
      setError(event.error);
      setStatus("error");
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setStatus((prev) => (prev === "error" ? prev : "idle"));
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setStatus("listening");
    } catch (err) {
      log.warn("failed to start recognition:", (err as Error).message);
      setError("start-failed");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          /* ignore */
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return { status, transcript, error, supported, start, stop };
}
