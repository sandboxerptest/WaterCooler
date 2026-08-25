/**
 * Who else is in the room, for anything that asks after the fact.
 *
 * The roster arrives on the socket and is announced as it changes. That is no
 * use to a panel opened later: it subscribes, hears nothing until somebody
 * moves, and in the meantime says the room is empty. Keeping the last one
 * here means a panel can start from what is true now and listen for the rest.
 */

import type { PresencePlayer } from "./presence-types";

let roster: PresencePlayer[] = [];

export function rememberPlayers(players: PresencePlayer[]): void {
  roster = players;
}

export function getPlayers(): PresencePlayer[] {
  return roster;
}
