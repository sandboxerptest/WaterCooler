import { describe, expect, it } from "vitest";
import { NO_INPUT } from "../types";
import {
  SCORE_FLIP,
  SCORE_TO_FOUNDATION,
  WIN_BONUS,
  createSolitaire,
  drawFromStock,
  fitsFoundation,
  fitsTableau,
  hasMoves,
  hit,
  moveTo,
  press,
  stepSolitaire,
  type Card,
} from "../solitaire";

const seeded = () => {
  let x = 12345;
  return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
};
const c = (suit: Card["suit"], rank: number, faceUp = true): Card => ({ suit, rank, faceUp });

describe("a deal", () => {
  it("lays out 28 cards in seven columns, the rest in the stock, all 52 once", () => {
    const s = createSolitaire(seeded());
    expect(s.tableau.map((p) => p.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.stock).toHaveLength(24);
    for (const pile of s.tableau) {
      pile.forEach((card, i) => expect(card.faceUp).toBe(i === pile.length - 1));
    }
    const all = [...s.stock, ...s.tableau.flat()].map((k) => `${k.suit}${k.rank}`);
    expect(new Set(all).size).toBe(52);
  });

  it("turns the stock one card at a time and gathers the waste back", () => {
    const s = createSolitaire(seeded());
    drawFromStock(s);
    expect(s.waste).toHaveLength(1);
    expect(s.waste[0].faceUp).toBe(true);
    for (let i = 0; i < 23; i++) drawFromStock(s);
    expect(s.stock).toHaveLength(0);
    drawFromStock(s);
    expect(s.stock).toHaveLength(24);
    expect(s.waste).toHaveLength(0);
  });
});

describe("the rules", () => {
  it("build foundations by suit from the ace, and columns by alternate colour downward", () => {
    expect(fitsFoundation([], c("H", 1))).toBe(true);
    expect(fitsFoundation([], c("H", 2))).toBe(false);
    expect(fitsFoundation([c("H", 1)], c("H", 2))).toBe(true);
    expect(fitsFoundation([c("H", 1)], c("S", 2))).toBe(false);
    expect(fitsTableau([], c("S", 13))).toBe(true);
    expect(fitsTableau([], c("S", 12))).toBe(false);
    expect(fitsTableau([c("S", 9)], c("H", 8))).toBe(true);
    expect(fitsTableau([c("S", 9)], c("C", 8))).toBe(false);
    expect(fitsTableau([c("S", 9, false)], c("H", 8))).toBe(false);
  });

  it("moves a run, flips what it uncovers, and scores the foundation", () => {
    const s = createSolitaire(seeded());
    s.tableau[0] = [c("D", 5, false), c("S", 9), c("H", 8)];
    s.tableau[1] = [c("D", 10)];
    s.selected = { pile: { kind: "tableau", i: 0 }, index: 1 };
    expect(moveTo(s, { kind: "tableau", i: 1 })).toBe(true);
    expect(s.tableau[1].map((k) => k.rank)).toEqual([10, 9, 8]);
    expect(s.tableau[0]).toHaveLength(1);
    expect(s.tableau[0][0].faceUp).toBe(true);
    expect(s.score).toBe(SCORE_FLIP);
    s.tableau[2] = [c("C", 1)];
    s.selected = { pile: { kind: "tableau", i: 2 }, index: 0 };
    expect(moveTo(s, { kind: "foundation", i: 0 })).toBe(true);
    expect(s.foundations[0]).toHaveLength(1);
    expect(s.score).toBe(SCORE_FLIP + SCORE_TO_FOUNDATION);
  });

  it("knows a dead deal from a live one, and a solved one", () => {
    const s = createSolitaire(seeded());
    s.stock = [];
    s.waste = [];
    s.tableau = [[c("S", 13)], [c("H", 13)], [], [], [], [], []];
    s.foundations = [[], [], [], []];
    expect(hasMoves(s)).toBe(false);
    s.tableau[2] = [c("D", 1)];
    expect(hasMoves(s)).toBe(true);
    // Finish it: everything on the foundations but one card.
    const full = (suit: Card["suit"]) => Array.from({ length: 13 }, (_, i) => c(suit, i + 1));
    s.foundations = [full("S"), full("H"), full("D"), full("C").slice(0, 12)];
    s.tableau = [[c("C", 13)], [], [], [], [], [], []];
    s.selected = { pile: { kind: "tableau", i: 0 }, index: 0 };
    expect(moveTo(s, { kind: "foundation", i: 3 })).toBe(true);
    expect(s.won).toBe(true);
    expect(s.over).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(WIN_BONUS);
  });
});

describe("pressing on the table", () => {
  it("finds the pile and card under a finger", () => {
    const s = createSolitaire(seeded());
    expect(hit(s, 20, 50)?.pile).toEqual({ kind: "stock" });
    expect(hit(s, 64, 50)?.pile).toEqual({ kind: "waste" });
    expect(hit(s, 150, 50)?.pile).toEqual({ kind: "foundation", i: 0 });
    const col = hit(s, 6 + 44 * 6 + 20, 104 + 7 * 6 + 10)!;
    expect(col.pile).toEqual({ kind: "tableau", i: 6 });
    expect(col.index).toBe(6);
    expect(hit(s, 20, 90)).toBeNull();
  });

  it("picks a face-up card up, puts it down where it fits, and turns the stock", () => {
    const s = createSolitaire(seeded());
    s.tableau[0] = [c("S", 9)];
    s.tableau[1] = [c("H", 8)];
    press(s, { pile: { kind: "tableau", i: 1 }, index: 0 });
    expect(s.selected).toEqual({ pile: { kind: "tableau", i: 1 }, index: 0 });
    press(s, { pile: { kind: "tableau", i: 0 }, index: 0 });
    expect(s.selected).toBeNull();
    expect(s.tableau[0].map((k) => k.rank)).toEqual([9, 8]);
    const before = s.waste.length;
    stepSolitaire(s, { ...NO_INPUT, tap: { x: 20, y: 50 } }, 1 / 60);
    expect(s.waste.length).toBe(before + 1);
  });
});
