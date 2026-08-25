"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { gameEvents } from "@/lib/events";
import { onRoomMessage, sendRoom } from "@/lib/room-socket";
import { getSelfId } from "@/lib/presence-self";
import { getPlayers } from "@/lib/presence-roster";
import type { PresencePlayer } from "@/lib/presence-types";
import {
  BALL_RADIUS,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  WINNING_SCORE,
  createPong,
  isMatchPoint,
  paddleX,
  stepPong,
  towardTarget,
  type PongState,
  type Side,
} from "@/lib/pong/game";
import { opponentMove, type Difficulty } from "@/lib/pong/opponent";
import { makeMatchId, type PongPayload } from "@/lib/pong/protocol";

/**
 * Ping pong at the water bucket.
 *
 * Three ways to be in a game and one game: against the computer, as the host
 * of a match against someone else in the room, or as their guest. The host
 * runs the same simulation the computer game runs and posts the result; the
 * guest draws what it is told and sends back where its bat is.
 */

const STEP = 1 / 120;
const MAX_FRAME = 0.1;
/** How often the host tells the guest where things are. Matches presence. */
const SYNC_MS = 50;

type Mode =
  | { at: "menu" }
  | { at: "waiting"; matchId: string; against: PresencePlayer }
  | { at: "computer"; difficulty: Difficulty }
  | {
      at: "match";
      matchId: string;
      side: Side;
      host: boolean;
      against: { id: string; name: string };
    };

interface Challenge {
  matchId: string;
  from: { id: string; name: string };
}

const DIFFICULTIES: Array<{ id: Difficulty; label: string; blurb: string }> = [
  { id: "easy", label: "Gentle", blurb: "misses a lot" },
  { id: "steady", label: "Steady", blurb: "a fair game" },
  { id: "sharp", label: "Sharp", blurb: "hard to beat" },
];

function drawTable(ctx: CanvasRenderingContext2D, state: PongState, you: Side | null) {
  ctx.fillStyle = "#12211a";
  ctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);

  // The net
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(TABLE_WIDTH / 2, 0);
  ctx.lineTo(TABLE_WIDTH / 2, TABLE_HEIGHT);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const side of ["left", "right"] as const) {
    ctx.fillStyle = side === you ? "#c9a227" : "#e8e2d8";
    ctx.fillRect(
      paddleX(side) - PADDLE_WIDTH / 2,
      state.paddles[side] - PADDLE_HEIGHT / 2,
      PADDLE_WIDTH,
      PADDLE_HEIGHT,
    );
  }

  ctx.beginPath();
  ctx.arc(state.ball.x, state.ball.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = state.servePause > 0 ? "rgba(255,255,255,0.35)" : "#ffffff";
  ctx.fill();
}

/** Where on the table, in its own coordinates, a pointer is. */
function tableYFromPointer(event: React.PointerEvent<HTMLElement>): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  if (bounds.height === 0) return TABLE_HEIGHT / 2;
  const fraction = (event.clientY - bounds.top) / bounds.height;
  return Math.min(TABLE_HEIGHT, Math.max(0, fraction * TABLE_HEIGHT));
}

export default function PingPong() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>({ at: "menu" });
  // Starts from whoever is already here: the roster is announced as it
  // changes, and a panel opened in a quiet moment would otherwise see nobody
  const [players, setPlayers] = useState<PresencePlayer[]>(getPlayers);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [display, setDisplay] = useState({
    left: 0,
    right: 0,
    winner: null as Side | null,
    matchPoint: null as Side | null,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<PongState | null>(null);
  const modeRef = useRef<Mode>(mode);
  const keysRef = useRef({ up: false, down: false });
  /** Where a finger is asking the bat to be, in table coordinates. */
  const touchTargetRef = useRef<number | null>(null);
  const guestPaddleRef = useRef<number | null>(null);
  const lastSyncRef = useRef(0);
  const challengeCount = useRef(0);

  // The socket handler is registered once and has to know how things stand
  // now, not how they stood when it was set up
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const send = useCallback((to: string, payload: PongPayload) => {
    sendRoom({ type: "pong", to, payload });
  }, []);

  const close = useCallback(() => {
    const current = modeRef.current;
    if (current.at === "match")
      send(current.against.id, { kind: "quit", matchId: current.matchId });
    if (current.at === "waiting")
      send(current.against.id, { kind: "quit", matchId: current.matchId });
    setOpen(false);
    setMode({ at: "menu" });
    gameRef.current = null;
    gameEvents.emit("pingpong-closed");
  }, [send]);

  // ── Opening ──
  useEffect(() => {
    const unsubscribe = gameEvents.on("open-pingpong", () => {
      setMode({ at: "menu" });
      gameRef.current = null;
      // Who is here, read at the moment the menu opens. The roster is
      // announced as it changes and this panel is mounted from the start, so
      // waiting to be told means an empty list until somebody moves.
      setPlayers(getPlayers());
      setOpen(true);
    });
    if (new URLSearchParams(window.location.search).get("pingpong") === "1") {
      gameEvents.emit("open-pingpong");
    }
    return unsubscribe;
  }, []);

  // The initial state above reads whoever is already here, so this only has
  // to carry the changes from then on
  useEffect(() => gameEvents.on("presence-updated", setPlayers), []);

  // ── Everything the other player sends ──
  useEffect(() => {
    return onRoomMessage((message) => {
      if (message.type !== "pong") return;
      const { payload, from } = message;
      const current = modeRef.current;

      switch (payload.kind) {
        case "invite":
          // A challenge can arrive while you are wandering about, so this
          // listens whether the game is open or not
          setChallenge({ matchId: payload.matchId, from });
          break;

        case "accept":
          if (current.at !== "waiting" || current.matchId !== payload.matchId) return;
          gameRef.current = createPong("right");
          setDisplay({ left: 0, right: 0, winner: null, matchPoint: null });
          setMode({
            at: "match",
            matchId: payload.matchId,
            side: "left",
            host: true,
            against: from,
          });
          break;

        case "decline":
          if (current.at !== "waiting" || current.matchId !== payload.matchId) return;
          setMode({ at: "menu" });
          break;

        case "quit":
          if (current.at !== "match" || current.matchId !== payload.matchId) return;
          setMode({ at: "menu" });
          gameRef.current = null;
          break;

        case "paddle":
          // Guest's bat, for the host to feed into the game
          if (current.at === "match" && current.host && current.matchId === payload.matchId) {
            guestPaddleRef.current = payload.y;
          }
          break;

        case "state": {
          if (current.at !== "match" || current.host || current.matchId !== payload.matchId) return;
          const game = gameRef.current;
          if (!game) return;
          // The host's word is final on everything except our own bat, which
          // we keep local so it answers the keys without waiting for a round trip
          const mine = game.paddles[current.side];
          game.ball = { ...payload.ball };
          game.paddles = { ...payload.paddles, [current.side]: mine };
          game.score = { ...payload.score };
          game.servePause = payload.servePause;
          game.winner = payload.winner;
          game.rallyHits = payload.rallyHits;
          break;
        }
      }
    });
  }, []);

  // ── Keys ──
  useEffect(() => {
    if (!open) return;
    const set = (event: KeyboardEvent, down: boolean) => {
      const key = event.key.toLowerCase();
      if (key === "arrowup" || key === "w") keysRef.current.up = down;
      else if (key === "arrowdown" || key === "s") keysRef.current.down = down;
      else if (key === "escape" && down) {
        close();
        return;
      } else return;
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
      keysRef.current = { up: false, down: false };
      touchTargetRef.current = null;
    };
  }, [open, close]);

  // ── The loop ──
  useEffect(() => {
    if (!open) return;
    const playing = mode.at === "computer" || mode.at === "match";
    if (!playing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    if (!gameRef.current) gameRef.current = createPong("right");

    const ratio = window.devicePixelRatio || 1;
    canvas.width = TABLE_WIDTH * ratio;
    canvas.height = TABLE_HEIGHT * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    let frame = 0;
    let last = performance.now();
    let carry = 0;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const game = gameRef.current;
      const current = modeRef.current;
      if (!game) return;

      carry += Math.min((now - last) / 1000, MAX_FRAME);
      last = now;

      const mySide: Side = current.at === "match" ? current.side : "left";
      const keyed = (keysRef.current.up ? -1 : 0) + (keysRef.current.down ? 1 : 0);
      const finger = touchTargetRef.current;
      const mine =
        keyed !== 0 || finger === null ? keyed : towardTarget(game.paddles[mySide], finger);

      while (carry >= STEP) {
        if (current.at === "computer") {
          stepPong(
            game,
            {
              left: mine as -1 | 0 | 1,
              right: opponentMove(game, "right", current.difficulty, STEP),
            },
            STEP,
          );
        } else if (current.at === "match" && current.host) {
          // The guest's bat is wherever it last said it was
          const guest = guestPaddleRef.current;
          const guestMove: -1 | 0 | 1 =
            guest === null
              ? 0
              : guest > game.paddles.right + 2
                ? 1
                : guest < game.paddles.right - 2
                  ? -1
                  : 0;
          stepPong(game, { left: mine as -1 | 0 | 1, right: guestMove }, STEP);
        } else {
          // Guest: only our own bat moves here; the rest arrives from the host
          stepPong(
            game,
            {
              left: mySide === "left" ? (mine as -1 | 0 | 1) : 0,
              right: mySide === "right" ? (mine as -1 | 0 | 1) : 0,
            },
            STEP,
          );
        }
        carry -= STEP;
      }

      // Tell the other player where things stand
      if (current.at === "match" && now - lastSyncRef.current > SYNC_MS) {
        lastSyncRef.current = now;
        if (current.host) {
          send(current.against.id, {
            kind: "state",
            matchId: current.matchId,
            ball: { ...game.ball },
            paddles: { ...game.paddles },
            score: { ...game.score },
            servePause: game.servePause,
            winner: game.winner,
            rallyHits: game.rallyHits,
          });
        } else {
          send(current.against.id, {
            kind: "paddle",
            matchId: current.matchId,
            y: game.paddles[current.side],
          });
        }
      }

      drawTable(ctx, game, current.at === "match" ? current.side : "left");

      const matchPoint = isMatchPoint(game);
      setDisplay((previous) =>
        previous.left === game.score.left &&
        previous.right === game.score.right &&
        previous.winner === game.winner &&
        previous.matchPoint === matchPoint
          ? previous
          : {
              left: game.score.left,
              right: game.score.right,
              winner: game.winner,
              matchPoint,
            },
      );
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, mode, send]);

  const challengeSomeone = (player: PresencePlayer) => {
    // Counted rather than timed: the pair of player ids already makes this
    // unique between browsers, so a counter is enough to tell one challenge
    // from the next — and it keeps the render pure
    const matchId = makeMatchId(getSelfId() ?? "me", player.id, (challengeCount.current += 1));
    send(player.id, { kind: "invite", matchId });
    setMode({ at: "waiting", matchId, against: player });
  };

  const acceptChallenge = () => {
    if (!challenge) return;
    send(challenge.from.id, { kind: "accept", matchId: challenge.matchId });
    gameRef.current = createPong("right");
    setDisplay({ left: 0, right: 0, winner: null, matchPoint: null });
    setMode({
      at: "match",
      matchId: challenge.matchId,
      side: "right",
      host: false,
      against: challenge.from,
    });
    setChallenge(null);
    setOpen(true);
  };

  const declineChallenge = () => {
    if (!challenge) return;
    send(challenge.from.id, { kind: "decline", matchId: challenge.matchId });
    setChallenge(null);
  };

  // A challenge is worth seeing even when the game is not open
  if (!open && challenge) {
    return (
      <div className="pong-toast pixel-panel">
        <div className="pong-toast__text">
          <strong>{challenge.from.name}</strong> fancies a game of ping pong
        </div>
        <div className="pong-toast__actions">
          <button
            type="button"
            className="pixel-button pixel-button--primary"
            onClick={acceptChallenge}
          >
            Play
          </button>
          <button type="button" className="pixel-button" onClick={declineChallenge}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  if (!open) return null;

  const you = mode.at === "match" ? mode.side : "left";
  const them: Side = you === "left" ? "right" : "left";

  return (
    <div
      className="pong-overlay"
      onClick={(event) => {
        // With a mouse, clicking beside the table leaves. With a finger that
        // is where you rest your hand while playing, so there the X is the
        // way out and the edge of the screen is not a trapdoor.
        if (event.target !== event.currentTarget) return;
        if (window.matchMedia("(pointer: coarse)").matches) return;
        close();
      }}
      role="dialog"
      aria-label="Ping pong"
    >
      <div className="pixel-panel pong-panel">
        <div className="pong-head">
          <span style={{ fontSize: "10px" }}>Ping pong</span>
          <button
            type="button"
            className="pixel-icon-btn"
            style={{ width: 26, height: 26 }}
            onClick={close}
            title="Close (Esc)"
            aria-label="Close ping pong"
          >
            <X size={12} />
          </button>
        </div>

        {mode.at === "menu" && (
          <div className="pong-menu">
            <div className="pong-menu__group">
              <div className="pong-menu__title">Against the computer</div>
              {DIFFICULTIES.map((level) => (
                <button
                  key={level.id}
                  type="button"
                  className="pixel-button pong-menu__item"
                  onClick={() => {
                    gameRef.current = createPong("right");
                    setDisplay({ left: 0, right: 0, winner: null, matchPoint: null });
                    setMode({ at: "computer", difficulty: level.id });
                  }}
                >
                  {level.label} <span className="pong-menu__blurb">{level.blurb}</span>
                </button>
              ))}
            </div>

            <div className="pong-menu__group">
              <div className="pong-menu__title">Against someone here</div>
              {players.length === 0 ? (
                <div className="pong-menu__empty">
                  Nobody else is in the room. Send them the room link and the bucket will still be
                  here.
                </div>
              ) : (
                players.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    className="pixel-button pong-menu__item"
                    onClick={() => challengeSomeone(player)}
                  >
                    Challenge {player.name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {mode.at === "waiting" && (
          <div className="pong-menu">
            <div className="pong-menu__title">Waiting for {mode.against.name} to say yes…</div>
            <button type="button" className="pixel-button" onClick={() => setMode({ at: "menu" })}>
              Never mind
            </button>
          </div>
        )}

        {(mode.at === "computer" || mode.at === "match") && (
          <>
            <div className="pong-score">
              <span className={you === "left" ? "pong-score__you" : undefined}>
                {mode.at === "match" && you === "right" ? mode.against.name : "You"} {display.left}
              </span>
              <span className="pong-score__dash">–</span>
              <span className={them === "right" ? undefined : "pong-score__you"}>
                {display.right}{" "}
                {mode.at === "match"
                  ? you === "left"
                    ? mode.against.name
                    : "You"
                  : DIFFICULTIES.find(
                      (d) => d.id === (mode as { difficulty: Difficulty }).difficulty,
                    )?.label}
              </span>
            </div>

            {/* Slide a finger anywhere on the table: the bat comes to it.
                Absolute rather than relative, because a bat that has to be
                dragged from wherever it happens to be is a poor way to
                answer a ball already on its way. */}
            <div
              className="pong-touch"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                touchTargetRef.current = tableYFromPointer(event);
              }}
              onPointerMove={(event) => {
                if (touchTargetRef.current === null) return;
                touchTargetRef.current = tableYFromPointer(event);
              }}
              onPointerUp={() => {
                touchTargetRef.current = null;
              }}
              onPointerCancel={() => {
                touchTargetRef.current = null;
              }}
            >
              <canvas ref={canvasRef} className="pong-table" />
            </div>

            <div className="pong-foot">
              {display.winner ? (
                <>
                  <span className="pong-foot__result">
                    {display.winner === you ? "You won." : "You lost."} First to {WINNING_SCORE}.
                  </span>
                  <button
                    type="button"
                    className="pixel-button pixel-button--primary"
                    onClick={() => {
                      gameRef.current = createPong("right");
                      setDisplay({ left: 0, right: 0, winner: null, matchPoint: null });
                    }}
                  >
                    Again
                  </button>
                </>
              ) : (
                <span className="pong-foot__hint">
                  {display.matchPoint ? "Match point. " : ""}Slide to move · ↑ ↓ or W / S · Esc to
                  leave
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
