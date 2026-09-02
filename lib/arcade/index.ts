import { breakout } from "./breakout";
import { flappy } from "./flappy";
import { snake } from "./snake";
import { oakIsland } from "./oak-island";
import { solitaire } from "./solitaire";
import type { ArcadeGame, ArcadeGameId } from "./types";

// Any state: the cabinet holds one game at a time and never looks inside.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyArcadeGame = ArcadeGame<any>;

/** The cabinet's three games, in menu order. */
export const ARCADE_GAMES: AnyArcadeGame[] = [oakIsland, flappy, snake, breakout, solitaire];

export function arcadeGame(id: string): AnyArcadeGame | null {
  return ARCADE_GAMES.find((g) => g.id === id) ?? null;
}

export function isArcadeGameId(value: unknown): value is ArcadeGameId {
  return (
    value === "flappy" ||
    value === "snake" ||
    value === "breakout" ||
    value === "oak-island" ||
    value === "solitaire"
  );
}
