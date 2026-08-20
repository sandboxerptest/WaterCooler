/**
 * Push-to-talk speech session.
 *
 * Kept out of React so the lifecycle can be tested without a browser or a
 * microphone. The important subtlety: the Web Speech API delivers the last
 * results *after* stop() is called, so the transcript can only be handed back
 * once recognition has actually ended — reading it synchronously on release
 * returns nothing.
 */

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}
export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
export interface SpeechRecognitionErrorEventLike {
  error: string;
}
export interface SpeechRecognitionLike {
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
  onstart?: (() => void) | null;
}

export interface SpeechSessionHandlers {
  /** Live text while listening, for the on-screen preview. */
  onInterim?: (text: string) => void;
  /** Called once per session with the complete transcript. Never called empty. */
  onResult?: (text: string) => void;
  /** Session ended with nothing recognised — the mic worked but heard no words. */
  onNoSpeech?: () => void;
  onError?: (error: string) => void;
  onStateChange?: (listening: boolean) => void;
}

/** Some browsers never fire onend after stop(); deliver anyway after this long. */
export const FLUSH_TIMEOUT_MS = 2000;

export function normaliseTranscript(final: string, interim: string): string {
  return `${final} ${interim}`.replace(/\s+/g, " ").trim();
}

export class SpeechSession {
  private createRecognition: () => SpeechRecognitionLike;
  private handlers: SpeechSessionHandlers;
  private recognition: SpeechRecognitionLike | null = null;
  private finalText = "";
  private interimText = "";
  private delivered = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    createRecognition: () => SpeechRecognitionLike,
    handlers: SpeechSessionHandlers = {},
  ) {
    this.createRecognition = createRecognition;
    this.handlers = handlers;
  }

  get listening(): boolean {
    return this.recognition !== null;
  }

  start() {
    if (this.recognition) return;

    this.finalText = "";
    this.interimText = "";
    this.delivered = false;

    const recognition = this.createRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) this.finalText += `${text} `;
        else interim += text;
      }
      this.interimText = interim;
      this.handlers.onInterim?.(normaliseTranscript(this.finalText, this.interimText));
    };

    recognition.onerror = (event) => {
      this.handlers.onError?.(event.error);
      this.finish(false);
    };

    recognition.onend = () => {
      this.finish(true);
    };

    try {
      recognition.start();
    } catch (err) {
      this.handlers.onError?.((err as Error).message || "start-failed");
      return;
    }

    this.recognition = recognition;
    this.handlers.onStateChange?.(true);
  }

  /**
   * Ask recognition to stop. The transcript arrives via onResult once the
   * engine flushes its final results, not from this call.
   */
  stop() {
    const recognition = this.recognition;
    if (!recognition) return;

    try {
      recognition.stop();
    } catch {
      /* already stopping */
    }

    // Belt and braces: if onend never comes, deliver what we have
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.finish(true);
    }, FLUSH_TIMEOUT_MS);
  }

  /** Drop the session without delivering anything (unmount, cancel). */
  abort() {
    const recognition = this.recognition;
    this.clearFlushTimer();
    this.recognition = null;
    this.delivered = true;
    if (recognition) {
      try {
        recognition.abort();
      } catch {
        /* ignore */
      }
    }
    this.handlers.onStateChange?.(false);
  }

  private finish(deliver: boolean) {
    this.clearFlushTimer();

    if (this.recognition) {
      this.recognition = null;
      this.handlers.onStateChange?.(false);
    }

    if (!deliver || this.delivered) return;
    this.delivered = true;

    const text = normaliseTranscript(this.finalText, this.interimText);
    this.finalText = "";
    this.interimText = "";
    if (text) this.handlers.onResult?.(text);
    else this.handlers.onNoSpeech?.();
  }

  private clearFlushTimer() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
