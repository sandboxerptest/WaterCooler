"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { DEFAULT_BGM_VOLUME } from "@/lib/constants";
import { loadBgmVolume, saveBgmVolume } from "@/lib/persistence";

const BGM_SRC = "/audio/bgm.mp3";

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_BGM_VOLUME;
  return Math.min(1, Math.max(0, value));
}

let sharedAudio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio(BGM_SRC);
    sharedAudio.loop = true;
    sharedAudio.preload = "auto";
  }
  return sharedAudio;
}

export interface BgmState {
  volume: number;
  setVolume: (percent: number) => void;
}

// ── Volume store ───────────────────────────────────────
// A module-level store keeps the persisted volume out of the render body so it
// can be read hydration-safely via useSyncExternalStore.

let storedVolume: number | null = null;
const volumeListeners = new Set<() => void>();

function readStoredVolume(): number {
  if (storedVolume === null) storedVolume = clampVolume(loadBgmVolume());
  return storedVolume;
}

function getServerVolume(): number {
  return DEFAULT_BGM_VOLUME;
}

function writeStoredVolume(value: number) {
  storedVolume = value;
  saveBgmVolume(value);
  for (const listener of volumeListeners) listener();
}

function subscribeVolume(listener: () => void): () => void {
  volumeListeners.add(listener);
  return () => {
    volumeListeners.delete(listener);
  };
}

export function useBgm(): BgmState {
  // The persisted volume lives in localStorage, which does not exist during
  // SSR. Reading it in the render body would make the client's first paint
  // disagree with the server's (a muted user gets a different music icon),
  // which React reports as a hydration mismatch. useSyncExternalStore renders
  // the server snapshot during hydration and swaps to the stored value after.
  const volume = useSyncExternalStore(subscribeVolume, readStoredVolume, getServerVolume);
  const volumeRef = useRef(volume);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    // Read the store directly: this runs once, and during hydration `volume`
    // is still the server snapshot rather than the user's saved setting.
    const stored = readStoredVolume();
    const audio = getAudio();
    audio.volume = stored;
    if (stored > 0) {
      audio.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (volume <= 0) return;
    const audio = getAudio();
    if (audio.paused) {
      const unlock = () => {
        if (volumeRef.current > 0) audio.play().catch(() => {});
      };
      window.addEventListener("pointerdown", unlock, { once: true, passive: true });
      window.addEventListener("keydown", unlock, { once: true });
      return () => {
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
      };
    }
  }, [volume]);

  const changeVolume = useCallback((percent: number) => {
    const v = clampVolume(percent / 100);
    writeStoredVolume(v);
    const audio = getAudio();
    audio.volume = v;
    if (v > 0 && audio.paused) {
      audio.play().catch(() => {});
    }
  }, []);

  return { volume, setVolume: changeVolume };
}
