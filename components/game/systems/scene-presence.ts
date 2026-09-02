import * as Phaser from "phaser";
import { RemotePlayerManager } from "./RemotePlayerManager";
import { ensureSheet } from "../utils/sheets";
import { WORKER_SPRITES } from "../config/animations";
import { gameEvents } from "@/lib/events";
import type { PresencePlayer } from "@/lib/presence-types";

/**
 * The other people in a place, for a scene that is not the office.
 *
 * The office wires this up by hand; the world map and the campuses share
 * this instead. It keeps the remote characters in step with the roster,
 * puts their words and their voice mark over their heads, fetches a sheet
 * this scene has not loaded yet so a person looks like themselves out here
 * too, and tells the room socket where our own character has just been put.
 */
export interface ScenePresence {
  /** Ease everyone toward their last reported position; call once a frame. */
  update(deltaMs: number): void;
  /** Take everyone down and stop listening; call when the scene goes. */
  detach(): void;
}

export function attachPresence(
  scene: Phaser.Scene,
  self: { x: number; y: number; facing: string },
  ownSay?: (text: string) => void,
): ScenePresence {
  // Outdoors everything sorts by its feet, and so do the people.
  const manager = new RemotePlayerManager(scene, { sortByY: true });
  let roster: PresencePlayer[] = [];
  const fetching = new Set<string>();

  const live = () => scene.sys?.isActive() === true;

  const sync = (players: PresencePlayer[]) => {
    // A roster that lands between a scene stopping and its listeners going
    // must not try to draw into it.
    if (!live()) return;
    roster = players;
    manager.sync(players);
    for (const player of players) {
      const key = player.spriteKey;
      if (scene.textures.exists(key) || fetching.has(key)) continue;
      const path = WORKER_SPRITES.find((w) => w.key === key)?.path;
      if (!path) continue;
      fetching.add(key);
      ensureSheet(scene, key, path, (ok) => {
        if (ok && scene.scene.isActive()) manager.sync(roster);
      });
    }
  };

  const offs = [
    gameEvents.on("presence-updated", sync),
    gameEvents.on("presence-left", (id) => live() && manager.remove(id)),
    gameEvents.on("player-said", (id, text) => live() && manager.say(id, text)),
    gameEvents.on("voice-speaking", (id, speaking) => live() && manager.setSpeaking(id, speaking)),
    ...(ownSay ? [gameEvents.on("self-said", ownSay)] : []),
  ];

  // Tell the socket where we stand, so it joins this place here and not
  // wherever the last scene left us.
  gameEvents.emit("place-entered", self);

  return {
    update: (deltaMs) => manager.update(deltaMs),
    detach: () => {
      for (const off of offs) off();
      manager.destroyAll();
    },
  };
}
