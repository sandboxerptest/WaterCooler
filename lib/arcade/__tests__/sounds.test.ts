import { describe, expect, it } from "vitest";
import { NO_INPUT, type ArcadeInput } from "../types";
import { createFlappy, stepFlappy } from "../flappy";
import { advance, createSnake } from "../snake";
import { applyPower, createBreakout, stepBreakout } from "../breakout";
import { createSolitaire, drawFromStock, moveTo } from "../solitaire";
import { act, createOakIsland, enterRoom, stepOakIsland } from "../oak-island/game";
import { ROOMS, TILE } from "../oak-island/world";
import { findTile } from "../oak-island/game";

const press: ArcadeInput = { ...NO_INPUT, actionPressed: true, action: true };

describe("the games leave sounds for the cabinet", () => {
  it("flappy flaps and dies out loud", () => {
    const s = createFlappy(() => 0.5);
    stepFlappy(s, press, 1 / 60);
    expect(s.sfx).toContain("flap");
    s.sfx = [];
    s.pipes = [];
    for (let i = 0; i < 300 && !s.over; i++) stepFlappy(s, NO_INPUT, 1 / 60);
    expect(s.sfx).toContain("die");
  });

  it("snake crunches an apple", () => {
    const s = createSnake(() => 0.5);
    s.apple = { x: s.body[0].x + 1, y: s.body[0].y };
    advance(s);
    expect(s.sfx).toContain("eat");
  });

  it("breakout launches, breaks, and catches a power", () => {
    const s = createBreakout(() => 0.99);
    stepBreakout(s, press, 1 / 60);
    expect(s.sfx).toContain("select");
    s.sfx = [];
    const brick = s.bricks.find((b) => b.alive)!;
    s.balls = [{ x: brick.x + 10, y: brick.y + 30, vx: 0, vy: -300 }];
    stepBreakout(s, NO_INPUT, 0.05);
    expect(s.sfx).toContain("brick");
    applyPower(s, "wide");
    expect(s.sfx).toContain("power");
  });

  it("solitaire shuffles, turns cards, and rings the foundation", () => {
    const s = createSolitaire(() => 0.5);
    expect(s.sfx).toContain("shuffle");
    s.sfx = [];
    drawFromStock(s);
    expect(s.sfx).toContain("card");
    s.tableau[0] = [{ suit: "H", rank: 1, faceUp: true }];
    s.selected = { pile: { kind: "tableau", i: 0 }, index: 0 };
    moveTo(s, { kind: "foundation", i: 0 });
    expect(s.sfx).toContain("foundation");
  });

  it("oak island digs, picks up, swings and steps between screens", () => {
    const s = createOakIsland(() => 0.5);
    stepOakIsland(s, press, 1 / 60);
    while (s.dialog.length) stepOakIsland(s, press, 1 / 60);
    s.items.push("shovel");
    const spot = findTile(ROOMS.cove, "dig")!;
    enterRoom(s, "cove", spot.x, spot.y + TILE);
    expect(s.sfx).toContain("step");
    s.enemies = [];
    s.facing = "up";
    s.sfx = [];
    act(s);
    expect(s.sfx).toContain("dig");
    expect(s.sfx).toContain("pickup");
    s.dialog = [];
    s.sfx = [];
    s.facing = "down";
    act(s);
    expect(s.sfx).toContain("swing");
  });
});
