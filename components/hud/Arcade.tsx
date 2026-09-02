"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Music, VolumeX, X } from "lucide-react";
import FullscreenButton, { useFullscreen } from "./FullscreenButton";
import PadLegend from "./PadLegend";
import { useMachinePad } from "@/lib/hooks/useMachinePad";
import { PAD_OWN_ATTR } from "@/lib/gamepad/dialogs";
import { gameEvents } from "@/lib/events";
import { currentRoom } from "@/lib/room-client";
import { loadPlayerName } from "@/lib/persistence";
import { createLogger } from "@/lib/logger";
import { ARCADE_GAMES, type AnyArcadeGame } from "@/lib/arcade";
import { NO_INPUT, SCREEN, type ArcadeGameId, type ArcadeInput } from "@/lib/arcade/types";
import { arcadeMusic } from "@/lib/arcade/music";
import { drainSounds } from "@/lib/arcade/sfx";

const log = createLogger("Arcade");

/** Never simulate more than this much time in one frame, however long it was. */
const MAX_FRAME = 0.05;

interface HighScore {
  player: string;
  score: number;
}

/** Gamepad, while a game is on: d-pad or stick steer and A is the action. */
function padInput(): Pick<ArcadeInput, "up" | "down" | "left" | "right" | "action"> {
  const none = { up: false, down: false, left: false, right: false, action: false };
  if (typeof navigator === "undefined" || !navigator.getGamepads) return none;
  for (const pad of navigator.getGamepads()) {
    if (!pad?.connected) continue;
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    return {
      up: y < -0.5 || !!pad.buttons[12]?.pressed,
      down: y > 0.5 || !!pad.buttons[13]?.pressed,
      left: x < -0.5 || !!pad.buttons[14]?.pressed,
      right: x > 0.5 || !!pad.buttons[15]?.pressed,
      action: !!pad.buttons[0]?.pressed,
    };
  }
  return none;
}

/**
 * The arcade cabinet: a menu of three games and a screen to play them on.
 * Escape backs out of a game to the menu, and out of the menu to the room.
 */
export default function Arcade() {
  const [open, setOpen] = useState(false);
  const [gameId, setGameId] = useState<ArcadeGameId | null>(null);
  const [cursor, setCursor] = useState(0);
  const [scores, setScores] = useState<Record<string, HighScore[]>>({});
  const [display, setDisplay] = useState({ score: 0, over: false });
  const musicMuted = useSyncExternalStore(
    arcadeMusic.subscribe,
    () => arcadeMusic.isMuted(),
    () => false,
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(overlayRef);
  const gameRef = useRef<{ game: AnyArcadeGame; state: unknown } | null>(null);
  const heldRef = useRef({ up: false, down: false, left: false, right: false, action: false });
  const pressedRef = useRef(false);
  const tapRef = useRef<{ x: number; y: number } | null>(null);
  const pointerRef = useRef<number | null>(null);
  const submittedRef = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setGameId(null);
    gameRef.current = null;
    arcadeMusic.close();
    gameEvents.emit("arcade-closed");
  }, []);

  const loadScores = useCallback(async () => {
    const room = encodeURIComponent(currentRoom());
    const loaded: Record<string, HighScore[]> = {};
    await Promise.all(
      ARCADE_GAMES.map(async (game) => {
        try {
          const res = await fetch(`/api/room/arcade?room=${room}&game=${game.id}`);
          const body = (await res.json()) as { scores?: HighScore[] };
          loaded[game.id] = body.scores ?? [];
        } catch (err) {
          log.warn(`could not load ${game.title} scores:`, (err as Error).message);
        }
      }),
    );
    setScores(loaded);
  }, []);

  const start = useCallback((id: ArcadeGameId) => {
    const game = ARCADE_GAMES.find((g) => g.id === id);
    if (!game) return;
    gameRef.current = { game, state: game.create() };
    submittedRef.current = false;
    pressedRef.current = false;
    tapRef.current = null;
    setDisplay({ score: 0, over: false });
    setGameId(id);
    // The island has its own song; the others play to the cabinet's.
    arcadeMusic.startGame(id);
  }, []);

  const backToMenu = useCallback(() => {
    gameRef.current = null;
    setGameId(null);
    arcadeMusic.backToMenu();
  }, []);

  // The controller, by the bindings printed on the cabinet: A plays the
  // chosen game, B backs out (of a game to the menu, of the menu to the
  // room), X fills the screen, Y is the music, View leaves, Menu restarts.
  // While a game is on, its own loop reads the stick and A.
  useMachinePad(open, {
    act: () => {
      if (!gameRef.current) start(ARCADE_GAMES[cursor].id);
    },
    back: () => (gameRef.current ? backToMenu() : close()),
    close,
    fullscreen: fullscreen.toggle,
    mute: () => arcadeMusic.setMuted(!arcadeMusic.isMuted()),
    restart: () => {
      if (gameId) start(gameId);
    },
    up: () => {
      if (!gameRef.current) setCursor((c) => (c + ARCADE_GAMES.length - 1) % ARCADE_GAMES.length);
    },
    down: () => {
      if (!gameRef.current) setCursor((c) => (c + 1) % ARCADE_GAMES.length);
    },
  });

  // ── Opening: the scene says when somebody walks up to the cabinet ──
  useEffect(() => {
    const unsubscribe = gameEvents.on("open-arcade", () => {
      setCursor(0);
      setGameId(null);
      void loadScores();
      setOpen(true);
      arcadeMusic.open();
    });
    if (new URLSearchParams(window.location.search).get("arcade") === "1") {
      gameEvents.emit("open-arcade");
    }
    return unsubscribe;
  }, [loadScores]);

  // Keys: Escape backs out; in the menu arrows pick and Enter starts; in a
  // game the arrows, WASD and Space are held state for the loop.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "escape") {
        event.preventDefault();
        if (gameRef.current) backToMenu();
        else close();
        return;
      }
      if (!gameRef.current) {
        if (key === "arrowdown" || key === "arrowright" || key === "s" || key === "d") {
          setCursor((c) => (c + 1) % ARCADE_GAMES.length);
        } else if (key === "arrowup" || key === "arrowleft" || key === "w" || key === "a") {
          setCursor((c) => (c + ARCADE_GAMES.length - 1) % ARCADE_GAMES.length);
        } else if (key === "enter" || key === " ") {
          setCursor((c) => {
            start(ARCADE_GAMES[c].id);
            return c;
          });
        } else return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const held = heldRef.current;
      if (key === "arrowup" || key === "w") held.up = true;
      else if (key === "arrowdown" || key === "s") held.down = true;
      else if (key === "arrowleft" || key === "a") held.left = true;
      else if (key === "arrowright" || key === "d") held.right = true;
      else if (key === " " || key === "enter") {
        if (!held.action) pressedRef.current = true;
        held.action = true;
      } else return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const held = heldRef.current;
      if (key === "arrowup" || key === "w") held.up = false;
      else if (key === "arrowdown" || key === "s") held.down = false;
      else if (key === "arrowleft" || key === "a") held.left = false;
      else if (key === "arrowright" || key === "d") held.right = false;
      else if (key === " " || key === "enter") held.action = false;
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      heldRef.current = { up: false, down: false, left: false, right: false, action: false };
    };
  }, [open, close, backToMenu, start]);

  const submitScore = useCallback(async (id: ArcadeGameId, score: number) => {
    try {
      const res = await fetch(`/api/room/arcade?room=${encodeURIComponent(currentRoom())}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: id, player: loadPlayerName(), score }),
      });
      const body = (await res.json()) as { scores?: HighScore[] };
      if (body.scores) setScores((prev) => ({ ...prev, [id]: body.scores! }));
    } catch (err) {
      log.warn("could not record the score:", (err as Error).message);
    }
  }, []);

  // The loop, while a game is on the screen.
  useEffect(() => {
    if (!open || !gameId) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = SCREEN.width * ratio;
    canvas.height = SCREEN.height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    let frame = 0;
    let last = performance.now();
    let padActionWas = false;
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      const current = gameRef.current;
      if (!current) return;
      const dt = Math.min((time - last) / 1000, MAX_FRAME);
      last = time;
      const pad = padInput();
      const padPressed = pad.action && !padActionWas;
      padActionWas = pad.action;
      const held = heldRef.current;
      const input: ArcadeInput = {
        ...NO_INPUT,
        up: held.up || pad.up,
        down: held.down || pad.down,
        left: held.left || pad.left,
        right: held.right || pad.right,
        action: held.action || pad.action,
        actionPressed: pressedRef.current || padPressed,
        pointerX: pointerRef.current,
        tap: tapRef.current,
      };
      pressedRef.current = false;
      tapRef.current = null;
      current.game.step(current.state, input, dt);
      drainSounds((current.state as { sfx?: unknown }).sfx);
      current.game.draw(ctx, current.state);
      const score = current.game.score(current.state);
      const over = current.game.over(current.state);
      setDisplay((prev) => (prev.score === score && prev.over === over ? prev : { score, over }));
      if (over && !submittedRef.current) {
        submittedRef.current = true;
        void submitScore(current.game.id, score);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, gameId, submitScore]);

  /** Where on the screen, in game pixels, a pointer event landed. */
  const screenPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * SCREEN.width,
      y: ((event.clientY - bounds.top) / bounds.height) * SCREEN.height,
    };
  };

  if (!open) return null;
  const game = gameId ? ARCADE_GAMES.find((g) => g.id === gameId) : null;
  const board = game ? (scores[game.id] ?? []) : [];

  return (
    <div
      ref={overlayRef}
      className="pinball-overlay"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        if (window.matchMedia("(pointer: coarse)").matches) return;
        close();
      }}
      role="dialog"
      aria-label="Arcade cabinet"
      {...{ [PAD_OWN_ATTR]: "" }}
    >
      <div className="pixel-panel pinball-panel arcade-panel">
        <div className="pinball-head arcade-head">
          <span className="arcade-head__title">{game ? game.title : "Arcade"}</span>
          <span className="arcade-head__buttons">
            {game && (
              <button
                type="button"
                className="pixel-icon-btn"
                style={{ width: 26, height: 26 }}
                onClick={backToMenu}
                title="Back to the games (Esc)"
                aria-label="Back to the games"
              >
                <ArrowLeft size={12} />
              </button>
            )}
            <button
              type="button"
              className="pixel-icon-btn"
              style={{ width: 26, height: 26 }}
              onClick={() => arcadeMusic.setMuted(!musicMuted)}
              title={
                musicMuted
                  ? "Music off — turn it on"
                  : "Music on — turn it off (sound effects stay)"
              }
              aria-label={musicMuted ? "Turn the music on" : "Turn the music off"}
              aria-pressed={musicMuted}
            >
              {musicMuted ? <VolumeX size={12} /> : <Music size={12} />}
            </button>
            <FullscreenButton control={fullscreen} what="the arcade" />
            <button
              type="button"
              className="pixel-icon-btn"
              style={{ width: 26, height: 26 }}
              onClick={close}
              title="Close (Esc)"
              aria-label="Close the arcade"
            >
              <X size={12} />
            </button>
          </span>
        </div>

        <div className="pinball-play">
          {game ? (
            <canvas
              ref={canvasRef}
              className="arcade-screen"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                const point = screenPoint(event);
                tapRef.current = point;
                pointerRef.current = point.x;
              }}
              onPointerMove={(event) => {
                if (pointerRef.current !== null) pointerRef.current = screenPoint(event).x;
              }}
              onPointerUp={() => {
                pointerRef.current = null;
              }}
              onPointerCancel={() => {
                pointerRef.current = null;
              }}
            />
          ) : (
            <div className="arcade-menu" role="listbox" aria-label="Games">
              {ARCADE_GAMES.map((entry, index) => {
                const best = scores[entry.id]?.[0];
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={cursor === index}
                    className={`arcade-card${cursor === index ? " arcade-card--active" : ""}`}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => start(entry.id)}
                  >
                    <span className="arcade-card__title">{entry.title}</span>
                    <span className="arcade-card__blurb">{entry.blurb}</span>
                    <span className="arcade-card__best">
                      {best
                        ? `Best: ${best.player} · ${best.score.toLocaleString()}`
                        : "No scores yet"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="pinball-stats">
          {game ? (
            <>
              <div className="pinball-stat">
                <div className="pinball-label">SCORE</div>
                <div style={{ fontSize: "16px", color: "var(--pixel-accent)" }}>
                  {display.score.toLocaleString()}
                </div>
              </div>
              <div className="pinball-stat pinball-stat--scores">
                <div className="pinball-label">HIGH SCORES</div>
                {board.length === 0 ? (
                  <div className="pinball-hint">Nobody has played yet.</div>
                ) : (
                  board.map((entry, index) => (
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
                {display.over ? (
                  <button
                    type="button"
                    className="pixel-button pixel-button--primary"
                    onClick={() => start(game.id)}
                  >
                    Play again
                  </button>
                ) : game.restartLabel ? (
                  <button
                    type="button"
                    className="pixel-button"
                    onClick={() => start(game.id)}
                    title="Give this one up and start over"
                  >
                    {game.restartLabel}
                  </button>
                ) : null}
                <div className="pinball-hint pinball-hint--touch">{game.touch}</div>
                <div className="pinball-hint pinball-hint--keys">{game.keys}</div>
                <PadLegend
                  entries={[
                    ["act", "act"],
                    ["back", "menu"],
                    ["restart", game.restartLabel?.toLowerCase() ?? "again"],
                    ["mute", "music"],
                    ["fullscreen", "full screen"],
                    ["close", "leave"],
                    ["talk", "talk"],
                  ]}
                />
              </div>
            </>
          ) : (
            <div className="pinball-stat pinball-stat--foot">
              <div className="pinball-hint">Five games in one cabinet. Pick one.</div>
              <div className="pinball-hint pinball-hint--keys">
                ↑ ↓ choose · Enter plays · Esc leaves
              </div>
              <PadLegend
                entries={[
                  ["act", "play"],
                  ["back", "leave"],
                  ["mute", "music"],
                  ["fullscreen", "full screen"],
                  ["close", "leave"],
                  ["talk", "talk"],
                ]}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
