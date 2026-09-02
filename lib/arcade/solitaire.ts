/**
 * Solitaire — Klondike, one card at a time.
 *
 * Seven columns, a stock and waste, four foundations. Tap or click a card
 * to pick up the run from it, then tap where it goes; tap a picked-up card
 * again to send it to a foundation if it fits. With keys or a pad a cursor
 * walks the piles and the action button does the same picking and placing.
 * Points for building up the foundations; a stuck deal ends the game with
 * what was scored, a finished one with a bonus.
 */

import { FONT, SCREEN, type ArcadeGame, type ArcadeInput } from "./types";

export type Suit = "S" | "H" | "D" | "C";
export interface Card {
  suit: Suit;
  rank: number;
  faceUp: boolean;
}

export type PileRef =
  | { kind: "stock" }
  | { kind: "waste" }
  | { kind: "foundation"; i: number }
  | { kind: "tableau"; i: number };

export interface Selection {
  pile: PileRef;
  /** Index into the pile the run starts at. */
  index: number;
}

export interface SolitaireState {
  stock: Card[];
  waste: Card[];
  foundations: Card[][];
  tableau: Card[][];
  selected: Selection | null;
  cursor: PileRef;
  score: number;
  moves: number;
  over: boolean;
  won: boolean;
  message: string | null;
  messageUntil: number;
  t: number;
  sfx: string[];
  random: () => number;
}

export const CARD_W = 40;
export const CARD_H = 54;
const TOP_Y = 34;
const TAB_Y = 104;
const GAP = 44;
const LEFT = 6;
const DOWN_STEP = 7;
const UP_STEP = 17;
const SUITS: Suit[] = ["S", "H", "D", "C"];
const RED: Record<Suit, boolean> = { S: false, H: true, D: true, C: false };
const GLYPH: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export const SCORE_TO_FOUNDATION = 10;
export const SCORE_FLIP = 5;
export const SCORE_WASTE_TO_TABLEAU = 5;
export const WIN_BONUS = 500;

function deck(random: () => number): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS)
    for (let rank = 1; rank <= 13; rank++) cards.push({ suit, rank, faceUp: false });
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function createSolitaire(random: () => number = Math.random): SolitaireState {
  const cards = deck(random);
  const tableau: Card[][] = [];
  for (let col = 0; col < 7; col++) {
    const pile: Card[] = [];
    for (let row = 0; row <= col; row++) {
      const card = cards.pop()!;
      card.faceUp = row === col;
      pile.push(card);
    }
    tableau.push(pile);
  }
  return {
    stock: cards,
    waste: [],
    foundations: [[], [], [], []],
    tableau,
    selected: null,
    cursor: { kind: "stock" },
    score: 0,
    moves: 0,
    over: false,
    won: false,
    message: null,
    messageUntil: 0,
    t: 0,
    sfx: ["shuffle"],
    random,
  };
}

export function pileOf(state: SolitaireState, ref: PileRef): Card[] {
  switch (ref.kind) {
    case "stock":
      return state.stock;
    case "waste":
      return state.waste;
    case "foundation":
      return state.foundations[ref.i];
    case "tableau":
      return state.tableau[ref.i];
  }
}

function same(a: PileRef, b: PileRef): boolean {
  return a.kind === b.kind && (a as { i?: number }).i === (b as { i?: number }).i;
}

/** Whether a card may go on a foundation pile. */
export function fitsFoundation(pile: Card[], card: Card): boolean {
  const top = pile[pile.length - 1];
  if (!top) return card.rank === 1;
  return top.suit === card.suit && card.rank === top.rank + 1;
}

/** Whether a run headed by a card may go on a tableau column. */
export function fitsTableau(pile: Card[], card: Card): boolean {
  const top = pile[pile.length - 1];
  if (!top) return card.rank === 13;
  return top.faceUp && RED[top.suit] !== RED[card.suit] && card.rank === top.rank - 1;
}

function say(state: SolitaireState, text: string) {
  state.message = text;
  state.messageUntil = state.t + 1.5;
}

/** Turn the stock, or gather the waste back into it. */
export function drawFromStock(state: SolitaireState) {
  state.selected = null;
  if (state.stock.length) {
    const card = state.stock.pop()!;
    card.faceUp = true;
    state.waste.push(card);
    state.sfx.push("card");
  } else if (state.waste.length) {
    state.stock = state.waste.reverse().map((c) => ({ ...c, faceUp: false }));
    state.waste = [];
    state.sfx.push("shuffle");
  }
  state.moves += 1;
}

/** Take the run off a pile, flipping what it leaves behind. */
function take(state: SolitaireState, from: Selection): Card[] {
  const pile = pileOf(state, from.pile);
  const run = pile.splice(from.index);
  const top = pile[pile.length - 1];
  if (from.pile.kind === "tableau" && top && !top.faceUp) {
    top.faceUp = true;
    state.score += SCORE_FLIP;
  }
  return run;
}

/** Move the selected run to a pile, if the rules allow. */
export function moveTo(state: SolitaireState, to: PileRef): boolean {
  const from = state.selected;
  if (!from || to.kind === "stock" || same(from.pile, to)) return false;
  const source = pileOf(state, from.pile);
  const run = source.slice(from.index);
  if (!run.length) return false;
  const head = run[0];
  if (to.kind === "foundation") {
    if (run.length !== 1 || !fitsFoundation(state.foundations[to.i], head)) return false;
    state.foundations[to.i].push(...take(state, from));
    state.score += SCORE_TO_FOUNDATION;
    state.sfx.push("foundation");
  } else if (to.kind === "tableau") {
    if (!fitsTableau(state.tableau[to.i], head)) return false;
    state.tableau[to.i].push(...take(state, from));
    state.sfx.push("place");
    if (from.pile.kind === "waste") state.score += SCORE_WASTE_TO_TABLEAU;
    if (from.pile.kind === "foundation") state.score -= SCORE_TO_FOUNDATION;
  } else return false;
  state.selected = null;
  state.moves += 1;
  checkEnd(state);
  return true;
}

/** Send a single card to whichever foundation takes it. */
export function toFoundation(state: SolitaireState, from: Selection): boolean {
  const pile = pileOf(state, from.pile);
  if (from.index !== pile.length - 1) return false;
  const card = pile[from.index];
  const i = state.foundations.findIndex((f) => fitsFoundation(f, card));
  if (i < 0) return false;
  state.selected = from;
  return moveTo(state, { kind: "foundation", i });
}

/** Whether anything at all can still be done, so a dead deal can end. */
export function hasMoves(state: SolitaireState): boolean {
  if (state.stock.length || state.waste.length) return true;
  for (let i = 0; i < 7; i++) {
    const pile = state.tableau[i];
    const top = pile[pile.length - 1];
    if (top && state.foundations.some((f) => fitsFoundation(f, top))) return true;
    const first = pile.findIndex((c) => c.faceUp);
    if (first < 0) continue;
    for (let j = first; j < pile.length; j++) {
      const card = pile[j];
      for (let k = 0; k < 7; k++) {
        if (k === i) continue;
        // A king leading a whole column has nowhere better to go.
        if (j === 0 && !state.tableau[k].length) continue;
        if (fitsTableau(state.tableau[k], card)) return true;
      }
    }
  }
  return false;
}

function checkEnd(state: SolitaireState) {
  const done = state.foundations.reduce((n, f) => n + f.length, 0);
  if (done === 52) {
    state.won = true;
    state.over = true;
    state.score += WIN_BONUS;
    state.sfx.push("win");
    say(state, "SOLVED");
    return;
  }
  if (!hasMoves(state)) {
    state.over = true;
    state.sfx.push("lose");
    say(state, "NO MOVES LEFT");
  }
}

/** What was pressed: a pile, and a card in it when it has cards. */
export function hit(state: SolitaireState, x: number, y: number): Selection | null {
  if (y >= TOP_Y && y < TOP_Y + CARD_H) {
    const col = Math.floor((x - LEFT) / GAP);
    if (col === 0) return { pile: { kind: "stock" }, index: Math.max(0, state.stock.length - 1) };
    if (col === 1) return { pile: { kind: "waste" }, index: Math.max(0, state.waste.length - 1) };
    if (col >= 3 && col <= 6) {
      const i = col - 3;
      return {
        pile: { kind: "foundation", i },
        index: Math.max(0, state.foundations[i].length - 1),
      };
    }
    return null;
  }
  if (y >= TAB_Y) {
    const i = Math.floor((x - LEFT) / GAP);
    if (i < 0 || i > 6) return null;
    const pile = state.tableau[i];
    if (!pile.length) return { pile: { kind: "tableau", i }, index: 0 };
    // Walk down the fan: the last card whose top edge is above the press.
    let index = 0;
    let top = TAB_Y;
    for (let j = 0; j < pile.length; j++) {
      if (y >= top) index = j;
      top += pile[j].faceUp ? UP_STEP : DOWN_STEP;
    }
    return { pile: { kind: "tableau", i }, index };
  }
  return null;
}

/** A press on a pile: pick up, put down, or turn the stock. */
export function press(state: SolitaireState, at: Selection) {
  const pile = pileOf(state, at.pile);
  if (at.pile.kind === "stock") {
    drawFromStock(state);
    return;
  }
  if (state.selected) {
    if (same(state.selected.pile, at.pile)) {
      // The same card again: try the foundation; otherwise let go.
      if (!toFoundation(state, state.selected)) state.selected = null;
      return;
    }
    if (moveTo(state, at.pile)) return;
    // Not a legal place: say so, and pick the new card up instead, if there is one.
    state.sfx.push("thud");
  }
  if (!pile.length) {
    state.selected = null;
    return;
  }
  if (at.pile.kind === "foundation") {
    state.selected = { pile: at.pile, index: pile.length - 1 };
    return;
  }
  const index = at.pile.kind === "waste" ? pile.length - 1 : at.index;
  if (!pile[index].faceUp) {
    state.selected = null;
    return;
  }
  state.selected = { pile: at.pile, index };
  state.sfx.push("card");
}

// ── Keys and pads walk a cursor over the piles ──────────

const TOP_ROW: PileRef[] = [
  { kind: "stock" },
  { kind: "waste" },
  { kind: "foundation", i: 0 },
  { kind: "foundation", i: 1 },
  { kind: "foundation", i: 2 },
  { kind: "foundation", i: 3 },
];

function columnOf(ref: PileRef): number {
  if (ref.kind === "stock") return 0;
  if (ref.kind === "waste") return 1;
  if (ref.kind === "foundation") return 3 + ref.i;
  return ref.i;
}

function moveCursor(state: SolitaireState, dx: number, dy: number) {
  const c = state.cursor;
  if (dy !== 0) {
    if (c.kind === "tableau" && dy < 0) {
      const col = c.i;
      state.cursor = TOP_ROW.reduce((best, ref) =>
        Math.abs(columnOf(ref) - col) < Math.abs(columnOf(best) - col) ? ref : best,
      );
    } else if (c.kind !== "tableau" && dy > 0) {
      state.cursor = { kind: "tableau", i: Math.min(6, columnOf(c)) };
    }
    return;
  }
  if (c.kind === "tableau") state.cursor = { kind: "tableau", i: (c.i + dx + 7) % 7 };
  else {
    const at = TOP_ROW.findIndex((ref) => same(ref, c));
    state.cursor = TOP_ROW[(at + dx + TOP_ROW.length) % TOP_ROW.length];
  }
}

/** The action button on the cursor's pile; on a selected column, it shortens the run. */
function pressCursor(state: SolitaireState) {
  const ref = state.cursor;
  const pile = pileOf(state, ref);
  if (state.selected && same(state.selected.pile, ref) && ref.kind === "tableau") {
    const next = state.selected.index + 1;
    if (next < pile.length) {
      state.selected = { pile: ref, index: next };
      return;
    }
    if (!toFoundation(state, { pile: ref, index: pile.length - 1 })) state.selected = null;
    return;
  }
  if (ref.kind === "tableau" && !state.selected) {
    const first = pile.findIndex((c) => c.faceUp);
    if (first < 0) return;
    state.selected = { pile: ref, index: first };
    return;
  }
  press(state, { pile: ref, index: Math.max(0, pile.length - 1) });
}

interface KeyEdges {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}
const was: KeyEdges = { up: false, down: false, left: false, right: false };

export function stepSolitaire(state: SolitaireState, input: ArcadeInput, dt: number) {
  state.t += dt;
  if (state.message && state.t > state.messageUntil) state.message = null;
  if (state.over) return;
  if (input.tap) {
    const at = hit(state, input.tap.x, input.tap.y);
    if (at) press(state, at);
    return;
  }
  const edge = (key: keyof KeyEdges) => {
    const now = input[key];
    const pressed = now && !was[key];
    was[key] = now;
    return pressed;
  };
  if (edge("left")) moveCursor(state, -1, 0);
  if (edge("right")) moveCursor(state, 1, 0);
  if (edge("up")) moveCursor(state, 0, -1);
  if (edge("down")) moveCursor(state, 0, 1);
  if (input.actionPressed) pressCursor(state);
}

// ── Drawing ─────────────────────────────────────────────

function card(ctx: CanvasRenderingContext2D, c: Card, x: number, y: number, lit: boolean) {
  ctx.fillStyle = c.faceUp ? "#f4efe4" : "#2d5a8f";
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.strokeStyle = lit ? "#f2c94c" : "#1a1a2a";
  ctx.lineWidth = lit ? 2 : 1;
  ctx.strokeRect(x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1);
  if (!c.faceUp) {
    ctx.fillStyle = "#4b7fb8";
    for (let i = 6; i < CARD_H - 6; i += 8)
      for (let j = 6; j < CARD_W - 6; j += 8) ctx.fillRect(x + j, y + i, 3, 3);
    return;
  }
  ctx.fillStyle = RED[c.suit] ? "#c0392b" : "#1a1a2a";
  ctx.font = `9px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(RANKS[c.rank], x + 3, y + 11);
  ctx.font = "11px sans-serif";
  ctx.fillText(GLYPH[c.suit], x + 3, y + 23);
  ctx.font = "18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(GLYPH[c.suit], x + CARD_W / 2, y + CARD_H - 10);
}

function slot(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  ctx.strokeStyle = "#2f5a44";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1);
  if (label) {
    ctx.fillStyle = "#2f5a44";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x + CARD_W / 2, y + CARD_H / 2 + 6);
  }
}

export function drawSolitaire(ctx: CanvasRenderingContext2D, state: SolitaireState) {
  const { width, height } = SCREEN;
  ctx.fillStyle = "#1c4a34";
  ctx.fillRect(0, 0, width, height);
  const lit = (ref: PileRef, index: number) =>
    !!state.selected && same(state.selected.pile, ref) && index >= state.selected.index;
  const cursorAt = (ref: PileRef) => same(state.cursor, ref);

  // Stock, waste, foundations.
  const stockX = LEFT;
  if (state.stock.length) card(ctx, state.stock[state.stock.length - 1], stockX, TOP_Y, false);
  else slot(ctx, stockX, TOP_Y, "↻");
  const wasteX = LEFT + GAP;
  const wasteTop = state.waste[state.waste.length - 1];
  if (wasteTop) card(ctx, wasteTop, wasteX, TOP_Y, lit({ kind: "waste" }, state.waste.length - 1));
  else slot(ctx, wasteX, TOP_Y, "");
  state.foundations.forEach((pile, i) => {
    const x = LEFT + GAP * (3 + i);
    const top = pile[pile.length - 1];
    if (top) card(ctx, top, x, TOP_Y, lit({ kind: "foundation", i }, pile.length - 1));
    else slot(ctx, x, TOP_Y, GLYPH[SUITS[i]]);
  });

  state.tableau.forEach((pile, i) => {
    const x = LEFT + GAP * i;
    if (!pile.length) slot(ctx, x, TAB_Y, "");
    let y = TAB_Y;
    pile.forEach((c, j) => {
      card(ctx, c, x, y, lit({ kind: "tableau", i }, j));
      y += c.faceUp ? UP_STEP : DOWN_STEP;
    });
  });

  // The cursor, for keys and pads: a bracket under the pile.
  const cursorX = LEFT + GAP * columnOf(state.cursor);
  const cursorY = state.cursor.kind === "tableau" ? TAB_Y - 6 : TOP_Y - 6;
  ctx.fillStyle = "#f2c94c";
  ctx.fillRect(cursorX, cursorY, CARD_W, 3);
  void cursorAt;

  ctx.fillStyle = "#e6e2d8";
  ctx.font = `8px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(`SCORE ${state.score}`, 8, 16);
  ctx.textAlign = "right";
  ctx.fillText(`MOVES ${state.moves}`, width - 8, 16);
  if (state.message) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#f2c94c";
    ctx.font = `12px ${FONT}`;
    ctx.fillText(state.message, width / 2, height - 40);
  }
  if (state.over) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = `10px ${FONT}`;
    ctx.fillText(state.won ? "YOU SOLVED IT" : "GAME OVER", width / 2, height - 20);
  }
}

export const solitaire: ArcadeGame<SolitaireState> = {
  id: "solitaire",
  title: "Solitaire",
  blurb: "Klondike, one card at a time.",
  keys: "Arrows walk the piles · Space picks up and puts down",
  touch: "Tap a card, then tap where it goes",
  create: createSolitaire,
  step: stepSolitaire,
  draw: drawSolitaire,
  score: (s) => s.score,
  over: (s) => s.over,
  restartLabel: "New deal",
};
