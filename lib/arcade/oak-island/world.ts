/**
 * Oak Island, as a handful of screens.
 *
 * Each screen is 16 tiles across and 22 down, drawn as a grid of characters.
 * The island's screens sit on a grid and join at their edges; the shaft
 * screens hang below the Money Pit, one ladder after another. The legend,
 * the things that stand on the tiles, and the words people say are all here,
 * so the game's rules and its drawing can both read from one place.
 */

export const COLS = 16;
export const ROWS = 22;
export const TILE = 20;
/** The map starts below a strip of hearts and pockets. */
export const MAP_TOP = 40;

export type Tile =
  | "grass"
  | "sand"
  | "water"
  | "tree"
  | "rock"
  | "path"
  | "swamp"
  | "wall"
  | "plank"
  | "shaft"
  | "dig"
  | "sign"
  | "boulder"
  | "cache"
  | "chest"
  | "ladder"
  | "ladderUp"
  | "ladderDown"
  | "vault"
  | "flood";

export const LEGEND: Record<string, Tile> = {
  ".": "grass",
  ",": "sand",
  "~": "water",
  T: "tree",
  R: "rock",
  "#": "path",
  s: "swamp",
  W: "wall",
  "=": "plank",
  D: "shaft",
  X: "dig",
  S: "sign",
  B: "boulder",
  b: "cache",
  C: "chest",
  L: "ladder",
  "^": "ladderUp",
  v: "ladderDown",
  V: "vault",
  F: "flood",
};

/** Whether a tile can be walked on at all; the flood needs the fibre besides. */
export const WALKABLE: Record<Tile, boolean> = {
  grass: true,
  sand: true,
  water: false,
  tree: false,
  rock: false,
  path: true,
  swamp: true,
  wall: false,
  plank: true,
  shaft: true,
  dig: true,
  sign: false,
  boulder: false,
  cache: false,
  chest: false,
  ladder: true,
  ladderUp: true,
  ladderDown: true,
  vault: false,
  flood: true,
};

export type Item = "shovel" | "fibre" | "cross" | "lantern" | "cipher";

export const ITEM_NAMES: Record<Item, string> = {
  shovel: "Shovel",
  fibre: "Coconut fibre",
  cross: "Lead cross",
  lantern: "Lantern",
  cipher: "The cipher",
};

export type EnemyKind = "crab" | "wisp" | "skeleton" | "ghost";

export interface EnemySpawn {
  kind: EnemyKind;
  /** Tile coordinates. */
  tx: number;
  ty: number;
}

export interface RoomDef {
  id: string;
  name: string;
  rows: string[];
  /** Neighbours by edge, when walking off it leads somewhere. */
  exits: { up?: string; down?: string; left?: string; right?: string };
  enemies: EnemySpawn[];
  /** Underground: dark unless the lantern is lit. */
  dark?: boolean;
  /** Where the ladder at the top of the screen comes out (for climbing back up). */
  ladderUpTo?: string;
  ladderDownTo?: string;
}

const LANDING = [
  "~~~~~~~,,~~~~~~~",
  "~~~~~~~,,~~~~~~~",
  "~~~~~~~,,~~~~~~~",
  "~~~~~,,,,,,~~~~~",
  ",,,,,,,,,,,,,,,,",
  "T.T...S.......TT",
  "T............,.T",
  "T..T.......T...T",
  "...............T",
  "................",
  "................",
  "...T.........T..",
  "T.......T......T",
  "T..............T",
  "TT....R....TT..T",
  "T..T........T..T",
  "T......TT......T",
  "TT..T......T...T",
  "T.............TT",
  "TT..T.....T....T",
  "TTT....##....TTT",
  "TTTT...##...TTTT",
];

const SWAMP = [
  "TTTTTTTTTTTTTTTT",
  "T..ssss....TT..T",
  "T.ssssss......TT",
  "T.ss..ss.....T.T",
  "Tsss.B.sss.....T",
  "Tss..s..ss...T.T",
  "Ts.B.b.B.ss....T",
  "Tss..s..sss.....",
  "Tsss.B.sss......",
  "T.sss.ssss......",
  "T..sssss....T...",
  "T...sss.......T.",
  "TT...s....T....T",
  "T...........T..T",
  "T.T.....TT.....T",
  "T........T....TT",
  "TT....T......T.T",
  "T.....T.....T..T",
  "T..T.......T...T",
  "TT.......T.....T",
  "TTT....##....TTT",
  "TTTT...##...TTTT",
];

const COVE = [
  "TTTTTTTTT~~~~~~~",
  "T.......,,~~~~~~",
  "T.......,,,~~~~~",
  "T..T....,,,,~~~~",
  "T.......,,,,,~~~",
  "T...T...,,,,,~~~",
  "T.......,,,R,~~~",
  "T.......,,,,,~~~",
  "........,,X,,~~~",
  "........,,,,,~~~",
  "........,,,,R~~~",
  "T....T..,,,,,~~~",
  "T.......,,,,,~~~",
  "T..T....,,R,,~~~",
  "T.......,,,,,~~~",
  "T...T...,,,,,~~~",
  "T.......,,,,,~~~",
  "T.......S,,,,~~~",
  "T..T....,,,,,~~~",
  "T.......,,,,,~~~",
  "TT......,,,R,~~~",
  "TTTTTTTT,,,,,~~~",
];

const MONEY_PIT = [
  "TTTT...##...TTTT",
  "TT.....##.....TT",
  "T......##......T",
  "T..R...##..R...T",
  "T......##......T",
  "T.....####.....T",
  "T....######....T",
  "T...##FFFF##...T",
  "T...#FFFFFF#...T",
  "....#FFLFFF#....",
  "....#FFFFFF#....",
  "T...##FFFF##...T",
  "T....######....T",
  "T.....####.....T",
  "T......S.......T",
  "T..R.......R...T",
  "T..............T",
  "TT............TT",
  "T....T....T....T",
  "TT............TT",
  "TTT..........TTT",
  "TTTTTTTTTTTTTTTT",
];

const LOT8 = [
  "TTTT...##...TTTT",
  "T......##......T",
  "T......##.....TT",
  "T....WWWWWW....T",
  "T....W....W....T",
  "T....W.C..W.....",
  "T....W....W.....",
  "T....WW.WWW.....",
  "T..............T",
  "T....S.........T",
  "T.............TT",
  "T...R......R...T",
  "T..............T",
  "TT............TT",
  "T....T....T....T",
  "T..............T",
  "TT.....R......TT",
  "T..............T",
  "T....T....T....T",
  "TT............TT",
  "TTT..........TTT",
  "TTTTTTTTTTTTTTTT",
];

const SHAFT_30 = [
  "WWWWWWWWWWWWWWWW",
  "WWWWWWW^WWWWWWWW",
  "WWWDDDDDDDDDDWWW",
  "WWWD========DWWW",
  "WWWDDDDDDDDDDWWW",
  "WWWWWDDDDDDWWWWW",
  "WWWWWDDDDDDWWWWW",
  "WWWDDDDDDDDDDWWW",
  "WWWDWWDDDDWWDWWW",
  "WWWDWWDDDDWWDWWW",
  "WWWDDDDDDDDDDWWW",
  "WWWWDDDDDDDDWWWW",
  "WWWWDDDDDDDDWWWW",
  "WWDDDDDDDDDDDDWW",
  "WWDWWDDDDDDWWDWW",
  "WWDWWD====DWWDWW",
  "WWDDDDDDDDDDDDWW",
  "WWWWWWDDDDWWWWWW",
  "WWWWWWDDDDWWWWWW",
  "WWWWWDDDDDDDWWWW",
  "WWWWWDDDvDDDWWWW",
  "WWWWWWWWWWWWWWWW",
];

const SHAFT_90 = [
  "WWWWWWWWWWWWWWWW",
  "WWWWWDDD^DDDWWWW",
  "WWWWWDDDDDDDWWWW",
  "WWWWWDDDDDDWWWWW",
  "WWWDDDDDDDDDDDWW",
  "WWWD=DDDDDD=DWWW",
  "WWWDDDDDDDDDDDWW",
  "WWWWDDDDDDDDWWWW",
  "WWDDDDDDDDDDDDWW",
  "WWDDDDDSDDDDDDWW",
  "WWDDDDDDDDDDDDWW",
  "WWWDDDDDDDDDDWWW",
  "WWWDDDDDDDDDDDWW",
  "WWWDDD====DDDDWW",
  "WWWDDDDDDDDDDDWW",
  "WWWWWDDDDDDWWWWW",
  "WWWWDDDDDDDDWWWW",
  "WWWWDDDDDDDDWWWW",
  "WWWWWWDDDDWWWWWW",
  "WWWWWDDDDDDDWWWW",
  "WWWWWDDDvDDDWWWW",
  "WWWWWWWWWWWWWWWW",
];

const SHAFT_150 = [
  "WWWWWWWWWWWWWWWW",
  "WWWWWDDD^DDDWWWW",
  "WWWWWDDDDDDDWWWW",
  "WWWWWDDDDDDWWWWW",
  "WWWDDDDDDDDDDDWW",
  "WWWDDDDDDDDDDDWW",
  "WWWDD=DDDD=DDWWW",
  "WWWDDDDDDDDDDDWW",
  "WWWWDDDDDDDDWWWW",
  "WWDDDDDDDDDDDDWW",
  "WWDDDDDDDDDDDDWW",
  "WWDDDDDDDDDDDDWW",
  "WWWDDDDDDDDDDWWW",
  "WWWDDDDDDDDDDDWW",
  "WWWDDDDDDDDDDDWW",
  "WWWWWDDDDDDWWWWW",
  "WWWWWWDDDDWWWWWW",
  "WWWWWWDDDDWWWWWW",
  "WWWWWDDDDDDWWWWW",
  "WWWWWDDVDDDWWWWW",
  "WWWWWWWWWWWWWWWW",
  "WWWWWWWWWWWWWWWW",
];

export const ROOMS: Record<string, RoomDef> = {
  landing: {
    id: "landing",
    name: "The Causeway",
    rows: LANDING,
    exits: { left: "swamp", right: "cove", down: "pit" },
    enemies: [{ kind: "crab", tx: 3, ty: 15 }],
  },
  swamp: {
    id: "swamp",
    name: "The Swamp",
    rows: SWAMP,
    exits: { right: "landing", down: "lot8" },
    enemies: [
      { kind: "wisp", tx: 3, ty: 10 },
      { kind: "wisp", tx: 9, ty: 3 },
      { kind: "wisp", tx: 12, ty: 14 },
    ],
  },
  cove: {
    id: "cove",
    name: "Smith's Cove",
    rows: COVE,
    exits: { left: "landing" },
    enemies: [
      { kind: "crab", tx: 10, ty: 4 },
      { kind: "crab", tx: 11, ty: 15 },
      { kind: "crab", tx: 9, ty: 19 },
    ],
  },
  pit: {
    id: "pit",
    name: "The Money Pit",
    rows: MONEY_PIT,
    exits: { up: "landing", left: "lot8" },
    enemies: [
      { kind: "skeleton", tx: 3, ty: 17 },
      { kind: "skeleton", tx: 12, ty: 17 },
    ],
    ladderDownTo: "shaft30",
  },
  lot8: {
    id: "lot8",
    name: "Lot 8 — Ball's ruins",
    rows: LOT8,
    exits: { up: "swamp", right: "pit" },
    enemies: [
      { kind: "skeleton", tx: 8, ty: 12 },
      { kind: "skeleton", tx: 4, ty: 17 },
    ],
  },
  shaft30: {
    id: "shaft30",
    name: "30 feet down",
    rows: SHAFT_30,
    exits: {},
    enemies: [{ kind: "ghost", tx: 7, ty: 9 }],
    dark: true,
    ladderUpTo: "pit",
    ladderDownTo: "shaft90",
  },
  shaft90: {
    id: "shaft90",
    name: "90 feet down",
    rows: SHAFT_90,
    exits: {},
    enemies: [
      { kind: "ghost", tx: 3, ty: 5 },
      { kind: "ghost", tx: 11, ty: 13 },
    ],
    dark: true,
    ladderUpTo: "shaft30",
    ladderDownTo: "shaft150",
  },
  shaft150: {
    id: "shaft150",
    name: "150 feet down",
    rows: SHAFT_150,
    exits: {},
    enemies: [
      { kind: "ghost", tx: 4, ty: 5 },
      { kind: "ghost", tx: 10, ty: 10 },
      { kind: "ghost", tx: 7, ty: 14 },
    ],
    dark: true,
    ladderUpTo: "shaft90",
  },
};

export const START_ROOM = "landing";
export const START_TILE = { tx: 7, ty: 4 };

/** What a sign or stone says, by room. */
export const SIGNS: Record<string, string[]> = {
  landing: [
    "OAK ISLAND. Six have died seeking the treasure.",
    "The legend says seven must die before it is found.",
  ],
  cove: [
    "Smith's Cove. Five box drains feed the flood tunnel.",
    "Whoever digs the pit finds it full of the sea.",
  ],
  pit: [
    "The Money Pit. Oak platforms every ten feet.",
    "At ninety feet, a stone with strange marks.",
  ],
  lot8: ["Samuel Ball, a freed man, farmed this lot", "and died rich. Nobody knows how."],
};

/** The 90-foot stone, read by lantern light. */
export const STONE_CIPHER = [
  "The marks swim in the lantern's light...",
  "FORTY FEET BELOW, TWO MILLION POUNDS LIE BURIED.",
  "You have the cipher.",
];

export const STONE_DARK = ["A stone, cut with marks. Too dark to read them."];

export const DAN = [
  "Dan: You're here for the pit, then. They all are.",
  "Dan: Take my shovel. Watch the swamp, mind the cove.",
  "Dan: And whatever is down there... it flooded for a reason.",
];

export const DAN_AGAIN = ["Dan: The fibre from the cove keeps the water out. Old sailors' trick."];

export const FLOOD_BLOCKED = [
  "The pit is full of seawater. You'd drown before thirty feet.",
  "Something to stop the flood tunnel... the cove, maybe.",
];

export const VAULT_LOCKED = ["A vault door. A cross-shaped hollow, and marks like the stone's."];

export const VAULT_OPEN = [
  "The lead cross fits. The cipher turns the marks.",
  "The Chappell Vault opens. Gold. Parchment. A chest of...",
  "You are the seventh to reach it — and the first to leave.",
];

export const INTRO = [
  "1795. A boy finds a hollow under an oak on a small island.",
  "For two centuries, people dig. Six of them die.",
  "You are the next to try. Find what stops the flood.",
  "Find what opens the vault. Do not be the seventh.",
];
