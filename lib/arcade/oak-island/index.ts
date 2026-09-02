import type { ArcadeGame } from "../types";
import { createOakIsland, score, stepOakIsland, type OakState } from "./game";
import { drawOakIsland } from "./draw";

export const oakIsland: ArcadeGame<OakState> = {
  id: "oak-island",
  title: "Oak Island",
  blurb: "Dig for the treasure. Do not be the seventh.",
  keys: "Arrows or WASD walk · Space swings, digs and talks",
  touch: "Tap to walk there · tap by the hunter to act",
  create: createOakIsland,
  step: stepOakIsland,
  draw: drawOakIsland,
  score,
  over: (s) => s.over,
};
