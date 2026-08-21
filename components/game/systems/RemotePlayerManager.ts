import * as Phaser from "phaser";
import { RemotePlayer } from "../entities/RemotePlayer";
import type { PresencePlayer } from "@/lib/presence-types";

/** Keeps the set of remote characters in step with the server's roster. */
export class RemotePlayerManager {
  private scene: Phaser.Scene;
  private players = new Map<string, RemotePlayer>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get count(): number {
    return this.players.size;
  }

  /** Add, update and remove so the world matches the roster exactly. */
  sync(roster: PresencePlayer[]) {
    const seen = new Set<string>();

    for (const incoming of roster) {
      seen.add(incoming.id);
      const existing = this.players.get(incoming.id);
      if (existing) {
        existing.setTarget(incoming);
      } else {
        this.players.set(incoming.id, new RemotePlayer(this.scene, incoming));
      }
    }

    for (const [id, player] of this.players) {
      if (!seen.has(id)) {
        player.destroy();
        this.players.delete(id);
      }
    }
  }

  remove(id: string) {
    const player = this.players.get(id);
    if (!player) return;
    player.destroy();
    this.players.delete(id);
  }

  update(deltaMs: number) {
    for (const player of this.players.values()) player.update(deltaMs);
  }

  destroyAll() {
    for (const player of this.players.values()) player.destroy();
    this.players.clear();
  }
}
