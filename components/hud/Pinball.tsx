"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Music, VolumeX, X } from "lucide-react";
import { arcadeMusic } from "@/lib/arcade/music";
import FullscreenButton, { useFullscreen } from "./FullscreenButton";
import PadLegend from "./PadLegend";
import { useMachinePad } from "@/lib/hooks/useMachinePad";
import { PAD_OWN_ATTR } from "@/lib/gamepad/dialogs";
import { gameEvents } from "@/lib/events";
import { currentRoom } from "@/lib/room-client";
import { loadPlayerName } from "@/lib/persistence";
import { createLogger } from "@/lib/logger";
import { createGame, stepGame, type PinballState } from "@/lib/pinball/game";
import { combineInput, touchSide, type FlipperSide } from "@/lib/pinball/controls";
import { flipperSegment } from "@/lib/pinball/physics";
import {
  BALLS_PER_GAME,
  BUMPERS,
  DROP_TARGETS,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  WALLS,
} from "@/lib/pinball/table";

const log = createLogger("Pinball");

/** Fixed physics step. A ball crosses its own diameter in 15ms at full tilt. */
const STEP = 1 / 240;
/** Never simulate more than this much time in one frame, however long it was. */
const MAX_FRAME = 0.1;

interface HighScore {
  player: string;
  score: number;
}

/** Gamepad buttons: shoulders and d-pad flip, A works the plunger. */
const PAD_LEFT = [4, 14];
const PAD_RIGHT = [5, 15];
const PAD_LAUNCH = [0];

function padPressed(buttons: number[]): boolean {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return false;
  for (const pad of navigator.getGamepads()) {
    if (!pad?.connected) continue;
    if (buttons.some((b) => pad.buttons[b]?.pressed)) return true;
  }
  return false;
}

function padAxisLeft(): { left: boolean; right: boolean } {
  if (typeof navigator === "undefined" || !navigator.getGamepads) {
    return { left: false, right: false };
  }
  for (const pad of navigator.getGamepads()) {
    if (!pad?.connected) continue;
    const x = pad.axes[0] ?? 0;
    if (x < -0.5) return { left: true, right: false };
    if (x > 0.5) return { left: false, right: true };
  }
  return { left: false, right: false };
}

const COLOURS = {
  felt: "#101b24",
  wall: "#3f6f8a",
  wallLit: "#7fd4ff",
  bumper: "#c9a227",
  bumperHot: "#ffe680",
  flipper: "#e2554f",
  ball: "#e8f4ff",
  lane: "#1a2b38",
  target: "#4ade80",
  targetDown: "#24402f",
};

function drawTable(
  ctx: CanvasRenderingContext2D,
  state: PinballState,
  now: number,
  charge: number,
) {
  ctx.fillStyle = COLOURS.felt;
  ctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);

  // The lane, so the plunger side reads as a channel rather than empty felt
  ctx.fillStyle = COLOURS.lane;
  ctx.fillRect(282, 200, 30, TABLE_HEIGHT - 200);

  ctx.lineCap = "round";
  ctx.strokeStyle = COLOURS.wall;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const wall of WALLS) {
    ctx.moveTo(wall.a.x, wall.a.y);
    ctx.lineTo(wall.b.x, wall.b.y);
  }
  ctx.stroke();

  for (const bumper of BUMPERS) {
    const hit = state.lastHit;
    const hot = hit && hit.x === bumper.c.x && hit.y === bumper.c.y && now - hit.at < 0.18 ? 1 : 0;

    ctx.beginPath();
    ctx.arc(bumper.c.x, bumper.c.y, bumper.r + hot * 3, 0, Math.PI * 2);
    ctx.fillStyle = hot ? COLOURS.bumperHot : COLOURS.bumper;
    ctx.fill();
    ctx.strokeStyle = hot ? "#fff" : "#8b6914";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(bumper.c.x, bumper.c.y, Math.max(2, bumper.r - 7), 0, Math.PI * 2);
    ctx.fillStyle = COLOURS.felt;
    ctx.fill();
  }

  // The drop target bank: bright while standing, a stub once knocked down
  ctx.lineCap = "butt";
  DROP_TARGETS.forEach((target, index) => {
    const standing = state.standing[index];
    ctx.strokeStyle = standing ? COLOURS.target : COLOURS.targetDown;
    ctx.lineWidth = standing ? 8 : 3;
    ctx.beginPath();
    ctx.moveTo(target.a.x, target.a.y);
    ctx.lineTo(target.b.x, target.b.y);
    ctx.stroke();
  });
  ctx.lineCap = "round";

  ctx.strokeStyle = COLOURS.flipper;
  ctx.lineWidth = 12;
  for (const flipper of [state.flippers.left, state.flippers.right]) {
    const segment = flipperSegment(flipper);
    ctx.beginPath();
    ctx.moveTo(segment.a.x, segment.a.y);
    ctx.lineTo(segment.b.x, segment.b.y);
    ctx.stroke();
  }

  // The plunger, drawn as it is pulled back
  if (state.status === "ready") {
    ctx.strokeStyle = COLOURS.wallLit;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(297, 548);
    ctx.lineTo(297, 548 - 26 * (1 - charge));
    ctx.stroke();
  }

  const { p, r } = state.ball;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = COLOURS.ball;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.x - 2, p.y - 2, r / 2.6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

export default function Pinball() {
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<HighScore[]>([]);
  const [display, setDisplay] = useState({
    score: 0,
    ballsLeft: BALLS_PER_GAME,
    status: "ready" as PinballState["status"],
    multiplier: 1,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(overlayRef);
  const gameRef = useRef<PinballState | null>(null);
  const keysRef = useRef({ left: false, right: false, launch: false });
  const submittedRef = useRef(false);
  /** Which side each finger is on. A map, because two thumbs is the point. */
  const touchesRef = useRef(new Map<number, FlipperSide>());

  const musicMuted = useSyncExternalStore(
    arcadeMusic.subscribe,
    () => arcadeMusic.isMuted(),
    () => false,
  );

  const close = useCallback(() => {
    setOpen(false);
    touchesRef.current.clear();
    arcadeMusic.closePinball();
    gameEvents.emit("pinball-closed");
  }, []);

  const loadScores = useCallback(async () => {
    try {
      const response = await fetch(`/api/room/pinball?room=${encodeURIComponent(currentRoom())}`);
      const body = (await response.json()) as { scores?: HighScore[] };
      setScores(body.scores ?? []);
    } catch (err) {
      log.warn("could not load the high scores:", (err as Error).message);
    }
  }, []);

  const startGame = useCallback(() => {
    gameRef.current = createGame();
    submittedRef.current = false;
    setDisplay({ score: 0, ballsLeft: BALLS_PER_GAME, status: "ready", multiplier: 1 });
  }, []);

  // ── Opening: the scene says when somebody walks up to the cauldron ──
  useEffect(() => {
    const unsubscribe = gameEvents.on("open-pinball", () => {
      startGame();
      void loadScores();
      setOpen(true);
      arcadeMusic.openPinball();
    });
    // ?pinball=1 opens it directly, the way ?board=1 opens the whiteboard.
    // Routed through the same event, so there is only one way in.
    if (new URLSearchParams(window.location.search).get("pinball") === "1") {
      gameEvents.emit("open-pinball");
    }
    return unsubscribe;
  }, [startGame, loadScores]);

  // The controller, by the bindings printed on the table: B or View leaves,
  // X fills the screen, Y is the music, Menu plays again once the balls are
  // gone. The flippers and plunger are read by the loop itself.
  useMachinePad(open, {
    close,
    fullscreen: fullscreen.toggle,
    mute: () => arcadeMusic.setMuted(!arcadeMusic.isMuted()),
    restart: () => {
      if (gameRef.current?.status === "over") startGame();
    },
  });

  // Escape closes, the way every other panel in the game does.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  // Flippers and plunger. Held state rather than presses: a flipper is a
  // button you hold, and the plunger charges for as long as you pull it.
  useEffect(() => {
    if (!open) return;

    const set = (event: KeyboardEvent, down: boolean) => {
      const key = event.key.toLowerCase();
      if (key === "arrowleft" || key === "a") keysRef.current.left = down;
      else if (key === "arrowright" || key === "d") keysRef.current.right = down;
      else if (key === " " || key === "arrowdown" || key === "s") keysRef.current.launch = down;
      else return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onDown = (event: KeyboardEvent) => set(event, true);
    const onUp = (event: KeyboardEvent) => set(event, false);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      keysRef.current = { left: false, right: false, launch: false };
    };
  }, [open]);

  const submitScore = useCallback(async (score: number) => {
    try {
      const response = await fetch(`/api/room/pinball?room=${encodeURIComponent(currentRoom())}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player: loadPlayerName(), score }),
      });
      const body = (await response.json()) as { scores?: HighScore[] };
      if (body.scores) setScores(body.scores);
    } catch (err) {
      log.warn("could not record the score:", (err as Error).message);
    }
  }, []);

  // The loop
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = TABLE_WIDTH * ratio;
    canvas.height = TABLE_HEIGHT * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    let frame = 0;
    let last = performance.now();
    let clock = 0;
    let carry = 0;

    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      const state = gameRef.current;
      if (!state) return;

      const elapsed = Math.min((time - last) / 1000, MAX_FRAME);
      last = time;
      carry += elapsed;

      const stick = padAxisLeft();
      const sides = [...touchesRef.current.values()];
      const input = combineInput({
        keys: keysRef.current,
        pad: {
          left: stick.left || padPressed(PAD_LEFT),
          right: stick.right || padPressed(PAD_RIGHT),
          launch: padPressed(PAD_LAUNCH),
        },
        touch: {
          left: sides.includes("left"),
          right: sides.includes("right"),
          count: sides.length,
        },
        status: state.status,
      });

      while (carry >= STEP) {
        stepGame(state, input, STEP, clock);
        carry -= STEP;
        clock += STEP;
      }

      drawTable(ctx, state, clock, state.charge);

      setDisplay((previous) =>
        previous.score === state.score &&
        previous.ballsLeft === state.ballsLeft &&
        previous.status === state.status &&
        previous.multiplier === state.multiplier
          ? previous
          : {
              score: state.score,
              ballsLeft: state.ballsLeft,
              status: state.status,
              multiplier: state.multiplier,
            },
      );

      // One submission per game, on the frame the last ball is lost
      if (state.status === "over" && !submittedRef.current) {
        submittedRef.current = true;
        void submitScore(state.score);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, submitScore]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Which half of the *screen* was touched, not which half of the table.
    // The table is a panel in the middle of a phone screen, so a thumb where
    // thumbs actually rest — at the edge — was landing on the backdrop and
    // closing the game rather than working that flipper.
    //
    // No pointer capture: the surface is the whole screen, so a thumb cannot
    // slide off it, and capturing would steal the taps meant for the buttons.
    const bounds = event.currentTarget.getBoundingClientRect();
    touchesRef.current.set(event.pointerId, touchSide(event.clientX, bounds.left, bounds.width));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    touchesRef.current.delete(event.pointerId);
  };

  if (!open) return null;
  const ready = display.status === "ready";

  return (
    <div
      ref={overlayRef}
      className="pinball-overlay"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(event) => {
        // Clicking beside the table closes it with a mouse. On a touch screen
        // that same spot is where a thumb goes, so there the X is the way out
        // and a tap at the edge is a flipper.
        if (event.target !== event.currentTarget) return;
        if (window.matchMedia("(pointer: coarse)").matches) return;
        close();
      }}
      role="dialog"
      aria-label="Cauldron pinball"
      {...{ [PAD_OWN_ATTR]: "" }}
    >
      <div className="pixel-panel pinball-panel">
        <div className="pinball-head arcade-head">
          <span className="arcade-head__title">Cauldron</span>
          <span className="arcade-head__buttons">
            <button
              type="button"
              className="pixel-icon-btn"
              onClick={() => arcadeMusic.setMuted(!musicMuted)}
              title={musicMuted ? "Music off — turn it on" : "Music on — turn it off"}
              aria-label={musicMuted ? "Turn the music on" : "Turn the music off"}
              aria-pressed={musicMuted}
            >
              {musicMuted ? <VolumeX size={12} /> : <Music size={12} />}
            </button>
            <FullscreenButton control={fullscreen} what="pinball" />
            <button
              type="button"
              className="pixel-icon-btn"
              onClick={close}
              title="Close (Esc)"
              aria-label="Close pinball"
            >
              <X size={12} />
            </button>
          </span>
        </div>

        {/* Everything inside here answers to a thumb: the side of this box you
            touch is the flipper that swings, and while the ball is still in
            the lane, holding anywhere pulls the plunger. */}
        <div className="pinball-play">
          <canvas ref={canvasRef} className="pinball-table" />
        </div>

        <div className="pinball-stats">
          <div className="pinball-stat">
            <div className="pinball-label">
              <span>SCORE</span>
              {display.multiplier > 1 && (
                <span style={{ color: "var(--pixel-green)" }}>×{display.multiplier}</span>
              )}
            </div>
            <div style={{ fontSize: "16px", color: "var(--pixel-accent)" }}>
              {display.score.toLocaleString()}
            </div>
          </div>

          <div className="pinball-stat">
            <div className="pinball-label">BALLS</div>
            <div style={{ fontSize: "12px" }}>
              {"●".repeat(Math.max(0, display.ballsLeft))}
              <span style={{ color: "var(--pixel-muted)" }}>
                {"○".repeat(BALLS_PER_GAME - Math.max(0, display.ballsLeft))}
              </span>
            </div>
          </div>

          <div className="pinball-stat pinball-stat--scores">
            <div className="pinball-label">HIGH SCORES</div>
            {scores.length === 0 ? (
              <div className="pinball-hint">Nobody has played yet.</div>
            ) : (
              scores.map((entry, index) => (
                <div
                  key={`${entry.player}-${index}`}
                  className="pinball-score"
                  style={{ color: index === 0 ? "var(--pixel-accent)" : undefined }}
                >
                  <span>
                    {index + 1}. {entry.player}
                  </span>
                  <span>{entry.score.toLocaleString()}</span>
                </div>
              ))
            )}
          </div>

          <div className="pinball-stat pinball-stat--foot">
            {display.status === "over" ? (
              <button
                type="button"
                className="pixel-button pixel-button--primary"
                onClick={startGame}
              >
                Play again
              </button>
            ) : (
              <div className="pinball-hint">Drop all four targets for a multiplier</div>
            )}
            <div className="pinball-hint pinball-hint--touch">
              Tap either side of the screen to flip · hold to pull the plunger
            </div>
            <div className="pinball-hint pinball-hint--keys">
              {ready ? "Hold SPACE to pull, let go to fire" : "← → or A/D flip · Esc leaves"}
            </div>
            <PadLegend
              entries={[
                ["act", "plunger"],
                ["back", "leave"],
                ["restart", "again"],
                ["mute", "music"],
                ["fullscreen", "full screen"],
                ["close", "leave"],
                ["talk", "talk"],
              ]}
            />
            <div className="pinball-hint pinball-hint--keys">LB RB or ← → flip</div>
          </div>
        </div>
      </div>
    </div>
  );
}
