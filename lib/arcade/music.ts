"use client";

/**
 * The games' music.
 *
 * "Mighty Coin Drop" plays from the moment the arcade opens and under every
 * game but one: Oak Island has its own song, "Tide Under Oak", which takes
 * over while that game is on the screen and gives way again after. The
 * pinball machine has "Silver Ball Surge". The room's own music steps aside
 * for whichever machine is open and returns when it closes. One mute
 * switch, remembered in the browser, silences the songs and only the songs
 * — the games' sound effects are separate.
 */

import { pauseBgm, resumeBgm } from "@/lib/useBgm";

const COIN_SRC = "/audio/Mighty%20Coin%20Drop.mp3";
const OAK_SRC = "/audio/Tide%20Under%20Oak.mp3";
const PINBALL_SRC = "/audio/Silver%20Ball%20Surge.mp3";
const VOLUME = 0.55;
const LS_MUTED = "watercooler:arcade-music-muted";

type Track = "coin" | "oak" | "pinball";

const tracks: Partial<Record<Track, HTMLAudioElement>> = {};
let playing: Track | null = null;
let muted = false;
let loaded = false;
const listeners = new Set<() => void>();

function readMuted(): boolean {
  if (loaded) return muted;
  loaded = true;
  try {
    muted = window.localStorage.getItem(LS_MUTED) === "1";
  } catch {
    muted = false;
  }
  return muted;
}

function audio(track: Track): HTMLAudioElement {
  let el = tracks[track];
  if (!el) {
    el = new Audio(track === "coin" ? COIN_SRC : track === "oak" ? OAK_SRC : PINBALL_SRC);
    el.loop = true;
    el.preload = "auto";
    tracks[track] = el;
  }
  return el;
}

function play(track: Track) {
  if (playing === track) return;
  if (playing) {
    const old = audio(playing);
    old.pause();
    old.currentTime = 0;
  }
  playing = track;
  const el = audio(track);
  el.volume = VOLUME;
  el.muted = readMuted();
  void el.play().catch(() => {
    // Autoplay refused: the next press on the cabinet is a gesture.
  });
}

function stop() {
  if (!playing) return;
  const el = audio(playing);
  el.pause();
  el.currentTime = 0;
  playing = null;
}

export const arcadeMusic = {
  /** The cabinet lights up: the coin song, the room's music aside. */
  open() {
    if (typeof Audio === "undefined") return;
    pauseBgm();
    play("coin");
  },
  /** A game starts: its own song if it has one, the coin song otherwise. */
  startGame(id: string) {
    if (typeof Audio === "undefined") return;
    play(id === "oak-island" ? "oak" : "coin");
  },
  backToMenu() {
    if (typeof Audio === "undefined") return;
    play("coin");
  },
  close() {
    if (typeof Audio === "undefined") return;
    stop();
    resumeBgm();
  },
  /** The pinball machine lights up: its own song, the room's music aside. */
  openPinball() {
    if (typeof Audio === "undefined") return;
    pauseBgm();
    play("pinball");
  },
  closePinball() {
    this.close();
  },
  isMuted(): boolean {
    return typeof window === "undefined" ? false : readMuted();
  },
  setMuted(next: boolean) {
    muted = next;
    loaded = true;
    try {
      window.localStorage.setItem(LS_MUTED, next ? "1" : "0");
    } catch {
      // Then it is remembered for this visit only.
    }
    for (const el of Object.values(tracks)) if (el) el.muted = next;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
