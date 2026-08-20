import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SpeechSession,
  FLUSH_TIMEOUT_MS,
  normaliseTranscript,
  type SpeechRecognitionLike,
} from "../speech-session";

/** Stand-in for the browser's SpeechRecognition, driven by the test. */
class FakeRecognition implements SpeechRecognitionLike {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  started = false;
  stopped = false;
  aborted = false;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;

  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  abort() {
    this.aborted = true;
  }

  /** Emit a recognition result, as the engine would. */
  emit(transcript: string, isFinal: boolean) {
    this.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal, 0: { transcript }, length: 1 } },
    });
  }

  emitEnd() {
    this.onend?.();
  }

  emitError(error: string) {
    this.onerror?.({ error });
  }
}

function setup() {
  const recognition = new FakeRecognition();
  const onResult = vi.fn();
  const onInterim = vi.fn();
  const onError = vi.fn();
  const onStateChange = vi.fn();
  const session = new SpeechSession(() => recognition, {
    onResult,
    onInterim,
    onError,
    onStateChange,
  });
  return { recognition, session, onResult, onInterim, onError, onStateChange };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SpeechSession", () => {
  it("delivers the transcript that arrives after the button is released", () => {
    // The regression: engines flush their final result *after* stop(), so
    // reading the transcript synchronously on release loses the whole utterance.
    const { recognition, session, onResult } = setup();

    session.start();
    session.stop();
    expect(onResult).not.toHaveBeenCalled();

    recognition.emit("assign carol the login bug", true);
    recognition.emitEnd();

    expect(onResult).toHaveBeenCalledWith("assign carol the login bug");
  });

  it("keeps text spoken before release as well as after", () => {
    const { recognition, session, onResult } = setup();

    session.start();
    recognition.emit("first part ", true);
    session.stop();
    recognition.emit("second part", true);
    recognition.emitEnd();

    expect(onResult).toHaveBeenCalledWith("first part second part");
  });

  it("includes an unfinalised tail when the engine ends without finalising", () => {
    const { recognition, session, onResult } = setup();

    session.start();
    recognition.emit("half a sentence", false);
    session.stop();
    recognition.emitEnd();

    expect(onResult).toHaveBeenCalledWith("half a sentence");
  });

  it("delivers anyway when the engine never fires onend", () => {
    const { recognition, session, onResult } = setup();

    session.start();
    recognition.emit("stubborn engine", true);
    session.stop();

    expect(onResult).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FLUSH_TIMEOUT_MS);
    expect(onResult).toHaveBeenCalledWith("stubborn engine");
  });

  it("delivers only once when onend and the flush timer both fire", () => {
    const { recognition, session, onResult } = setup();

    session.start();
    recognition.emit("say once", true);
    session.stop();
    recognition.emitEnd();
    vi.advanceTimersByTime(FLUSH_TIMEOUT_MS * 2);

    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when nothing was said, but says so", () => {
    const recognition = new FakeRecognition();
    const onResult = vi.fn();
    const onNoSpeech = vi.fn();
    const session = new SpeechSession(() => recognition, { onResult, onNoSpeech });

    session.start();
    session.stop();
    recognition.emitEnd();

    expect(onResult).not.toHaveBeenCalled();
    expect(onNoSpeech).toHaveBeenCalledTimes(1);
  });

  it("reports errors and stops listening", () => {
    const { recognition, session, onError, onResult, onStateChange } = setup();

    session.start();
    recognition.emitError("not-allowed");

    expect(onError).toHaveBeenCalledWith("not-allowed");
    expect(onResult).not.toHaveBeenCalled();
    expect(session.listening).toBe(false);
    expect(onStateChange).toHaveBeenLastCalledWith(false);
  });

  it("streams interim text for the live preview", () => {
    const { recognition, session, onInterim } = setup();

    session.start();
    recognition.emit("hello", false);
    recognition.emit("hello there", false);

    expect(onInterim).toHaveBeenLastCalledWith("hello there");
  });

  it("abort throws the utterance away", () => {
    const { recognition, session, onResult } = setup();

    session.start();
    recognition.emit("never mind", true);
    session.abort();
    recognition.emitEnd();

    expect(recognition.aborted).toBe(true);
    expect(onResult).not.toHaveBeenCalled();
  });

  it("ignores a second start while already listening", () => {
    const { session, onStateChange } = setup();

    session.start();
    session.start();

    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it("tolerates stop() when nothing is running", () => {
    const { session } = setup();
    expect(() => session.stop()).not.toThrow();
  });

  it("collapses whitespace between fragments", () => {
    expect(normaliseTranscript("one  ", " two   three ")).toBe("one two three");
  });
});
