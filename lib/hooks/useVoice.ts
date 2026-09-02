"use client";

import { useEffect, useSyncExternalStore } from "react";
import { voiceChat, type VoiceView } from "../voice/voice-chat";

const OFF: VoiceView = { status: "off", peers: 0, inEarshot: 0, speaking: false, reason: null };

/** Keep voice chat listening to the room while mounted, and read its state. */
export function useVoice(): VoiceView {
  useEffect(() => voiceChat.attach(), []);
  return useSyncExternalStore(
    (listener) => voiceChat.subscribe(listener),
    () => voiceChat.snapshot(),
    () => OFF,
  );
}
