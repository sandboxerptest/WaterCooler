"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Minus, MousePointer2, Square, Circle, Trash2, X } from "lucide-react";
import { gameEvents } from "@/lib/events";
import { onRoomMessage, sendRoom } from "@/lib/room-socket";
import { currentRoom } from "@/lib/room-client";
import {
  BOARD_COLORS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOARD_WIDTHS,
  isStroke,
  type BoardTool,
  type Stroke,
} from "@/lib/whiteboard";
import { loadPlayerName } from "@/lib/persistence";
import { createLogger } from "@/lib/logger";

const log = createLogger("Whiteboard");

const TOOLS: Array<{ tool: BoardTool; label: string; Icon: typeof Square }> = [
  { tool: "pen", label: "Draw", Icon: MousePointer2 },
  { tool: "line", label: "Line", Icon: Minus },
  { tool: "rect", label: "Rectangle", Icon: Square },
  { tool: "ellipse", label: "Ellipse", Icon: Circle },
  { tool: "eraser", label: "Erase", Icon: Eraser },
];

/** How often an in-progress stroke is shared. Matches the presence tick. */
const STREAM_MS = 50;

/** Erasing is drawing in the board's own colour rather than removing strokes. */
const BOARD_BACKGROUND = "#16211f";

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const [x0, y0] = stroke.points;
  const lastX = stroke.points[stroke.points.length - 2];
  const lastY = stroke.points[stroke.points.length - 1];

  ctx.strokeStyle = stroke.tool === "eraser" ? BOARD_BACKGROUND : stroke.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = stroke.tool === "eraser" ? Math.max(stroke.width * 3, 18) : stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  switch (stroke.tool) {
    case "rect":
      ctx.rect(x0, y0, lastX - x0, lastY - y0);
      break;
    case "ellipse":
      ctx.ellipse(
        (x0 + lastX) / 2,
        (y0 + lastY) / 2,
        Math.abs(lastX - x0) / 2,
        Math.abs(lastY - y0) / 2,
        0,
        0,
        Math.PI * 2,
      );
      break;
    case "line":
      ctx.moveTo(x0, y0);
      ctx.lineTo(lastX, lastY);
      break;
    default: {
      ctx.moveTo(x0, y0);
      for (let i = 2; i < stroke.points.length; i += 2) {
        ctx.lineTo(stroke.points[i], stroke.points[i + 1]);
      }
    }
  }
  ctx.stroke();
}

/**
 * The office whiteboard.
 *
 * Everything drawn is shared: strokes go to the room as they are finished and
 * arrive for everyone else, and the board is restored from the server when
 * opened, so it is the same board for the next person who walks up to it.
 */
export default function Whiteboard() {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<BoardTool>("pen");
  const [color, setColor] = useState<string>(BOARD_COLORS[0]);
  const [width, setWidth] = useState<number>(BOARD_WIDTHS[1]);
  const [clearedBy, setClearedBy] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Finished strokes, already baked into the offscreen canvas. */
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  /** Strokes still being drawn — ours and other people's — keyed by id. */
  const liveRef = useRef<Map<string, Stroke>>(new Map());
  const draftRef = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);
  const lastSentRef = useRef(0);

  const baseCanvas = useCallback(() => {
    if (!baseRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = BOARD_WIDTH;
      canvas.height = BOARD_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = BOARD_BACKGROUND;
        ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      }
      baseRef.current = canvas;
    }
    return baseRef.current;
  }, []);

  /** Bake a finished stroke so it costs nothing to redraw from then on. */
  const commit = useCallback(
    (stroke: Stroke) => {
      const ctx = baseCanvas().getContext("2d");
      if (ctx) drawStroke(ctx, stroke);
      liveRef.current.delete(stroke.id);
    },
    [baseCanvas],
  );

  const repaint = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(baseCanvas(), 0, 0);
    for (const stroke of liveRef.current.values()) drawStroke(ctx, stroke);
    if (draftRef.current) drawStroke(ctx, draftRef.current);
  }, [baseCanvas]);

  const wipe = useCallback(() => {
    const ctx = baseCanvas().getContext("2d");
    if (ctx) {
      ctx.fillStyle = BOARD_BACKGROUND;
      ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    }
    liveRef.current.clear();
    draftRef.current = null;
  }, [baseCanvas]);

  // ── Opening: the scene says when somebody walks up and presses E ──
  useEffect(() => {
    const unsubscribe = gameEvents.on("open-whiteboard", () => setOpen(true));
    // ?board=1 opens it directly, for linking someone straight to the board.
    // Routed through the same event as walking up to it, so there is one way in.
    if (new URLSearchParams(window.location.search).get("board") === "1") {
      gameEvents.emit("open-whiteboard");
    }
    return unsubscribe;
  }, []);

  // ── Catch up with whatever is already on the board ──
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/room/board?room=${encodeURIComponent(currentRoom())}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { strokes?: unknown[] };
        if (cancelled) return;
        wipe();
        for (const stroke of (body.strokes ?? []).filter(isStroke)) commit(stroke);
        repaint();
      } catch (err) {
        log.warn("could not load the board:", (err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, repaint, wipe, commit]);

  // ── Other people's marks, live ──
  useEffect(() => {
    return onRoomMessage((message) => {
      if (message.type !== "board") return;

      if (message.action === "clear") {
        wipe();
        setClearedBy(message.by ?? "someone");
        repaint();
        return;
      }

      if (!isStroke(message.stroke)) return;

      // Keyed by id, so a stroke that arrives repeatedly as it grows replaces
      // the previous version instead of drawing over itself
      if (message.done) commit(message.stroke);
      else liveRef.current.set(message.stroke.id, message.stroke);
      repaint();
    });
  }, [repaint, wipe, commit]);

  useEffect(() => {
    if (open) repaint();
  }, [open, repaint]);

  // Escape closes, matching every other panel in the game
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        setOpen(false);
        gameEvents.emit("whiteboard-closed");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    // The office ignores movement while the board is up
    gameEvents.emit("whiteboard-closed");
  };

  if (!open) return null;

  /** Pointer position in board coordinates, whatever the canvas is scaled to. */
  const toBoard = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * BOARD_WIDTH,
      ((event.clientY - rect.top) / rect.height) * BOARD_HEIGHT,
    ];
  };

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    setClearedBy(null);
    const [x, y] = toBoard(event);
    draftRef.current = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      tool,
      color,
      width,
      points: [x, y, x, y],
      author: loadPlayerName(),
    };
    repaint();
  };

  const extendStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !draftRef.current) return;
    const [x, y] = toBoard(event);

    if (draftRef.current.tool === "pen" || draftRef.current.tool === "eraser") {
      draftRef.current.points.push(x, y);
    } else {
      // Shapes are defined by where you started and where you are now
      draftRef.current.points = [draftRef.current.points[0], draftRef.current.points[1], x, y];
    }
    repaint();

    // Share it as it is drawn, so the room watches the line appear rather than
    // waiting for the pen to lift. Sampled, because a pointer fires far faster
    // than anyone needs to see.
    const now = Date.now();
    if (now - lastSentRef.current >= STREAM_MS) {
      lastSentRef.current = now;
      sendRoom({ type: "board", action: "draw", stroke: draftRef.current, done: false });
    }
  };

  const finishStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;

    const stroke = draftRef.current;
    draftRef.current = null;
    if (!stroke) return;

    // Bake it locally first — the board should never feel laggy
    commit(stroke);
    repaint();
    sendRoom({ type: "board", action: "draw", stroke, done: true });
  };

  const clearBoard = () => {
    wipe();
    repaint();
    sendRoom({ type: "board", action: "clear" });
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 45,
        padding: 12,
        // The HUD layer is pointer-events: none so the game can be clicked
        // through it; anything interactive has to opt back in.
        pointerEvents: "auto",
      }}
      role="dialog"
      aria-label="Office whiteboard"
      onPointerDown={(event) => {
        // Clicking the dimmed surround closes, so the board is never a trap
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: "min(94vw, 1200px)",
          maxHeight: "100%",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "10px", marginRight: "auto" }}>WHITEBOARD</span>

          {TOOLS.map(({ tool: option, label, Icon }) => (
            <button
              key={option}
              type="button"
              className={`pixel-icon-btn ${tool === option ? "pixel-icon-btn--primary" : ""}`}
              style={{ width: 30, height: 30, minWidth: 30, minHeight: 30 }}
              onClick={() => setTool(option)}
              title={label}
              aria-label={label}
              aria-pressed={tool === option}
            >
              <Icon size={13} />
            </button>
          ))}

          <span style={{ display: "inline-flex", gap: 4, marginLeft: 6 }}>
            {BOARD_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => {
                  setColor(swatch);
                  if (tool === "eraser") setTool("pen");
                }}
                title={`Chalk ${swatch}`}
                aria-label={`Colour ${swatch}`}
                aria-pressed={color === swatch}
                style={{
                  width: 22,
                  height: 22,
                  background: swatch,
                  border:
                    color === swatch ? "2px solid var(--pixel-text, #fff)" : "2px solid #0006",
                  borderRadius: 3,
                  cursor: "pointer",
                }}
              />
            ))}
          </span>

          <span style={{ display: "inline-flex", gap: 4, marginLeft: 6 }}>
            {BOARD_WIDTHS.map((size) => (
              <button
                key={size}
                type="button"
                className={`pixel-icon-btn ${width === size ? "pixel-icon-btn--primary" : ""}`}
                style={{ width: 30, height: 30, minWidth: 30, minHeight: 30 }}
                onClick={() => setWidth(size)}
                title={`${size}px`}
                aria-label={`Thickness ${size}`}
                aria-pressed={width === size}
              >
                <span
                  style={{
                    display: "block",
                    width: 14,
                    height: Math.max(2, size / 2),
                    background: "currentColor",
                    borderRadius: 2,
                  }}
                />
              </button>
            ))}
          </span>

          <button
            type="button"
            className="pixel-button"
            style={{ fontSize: "8px", padding: "4px 10px" }}
            onClick={clearBoard}
            title="Wipe the board for everyone in the room"
          >
            <Trash2 size={11} /> Clear
          </button>

          <button
            type="button"
            className="pixel-icon-btn"
            style={{ width: 30, height: 30, minWidth: 30, minHeight: 30 }}
            onClick={close}
            title="Close (Esc)"
            aria-label="Close the whiteboard"
          >
            <X size={13} />
          </button>
        </div>

        {/* Shrinks to fit both the width and the height available, so the
            toolbar and the close button are always reachable */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            placeItems: "center",
          }}
        >
          <canvas
            ref={canvasRef}
            width={BOARD_WIDTH}
            height={BOARD_HEIGHT}
            onPointerDown={startStroke}
            onPointerMove={extendStroke}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            style={{
              aspectRatio: `${BOARD_WIDTH} / ${BOARD_HEIGHT}`,
              maxWidth: "100%",
              maxHeight: "100%",
              width: "auto",
              height: "auto",
              background: BOARD_BACKGROUND,
              border: "3px solid var(--pixel-border, #5b4636)",
              borderRadius: 4,
              cursor: "crosshair",
              touchAction: "none",
            }}
          />
        </div>

        <div
          style={{
            fontSize: "8px",
            color: "var(--pixel-muted)",
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {clearedBy
            ? `${clearedBy} cleared the board`
            : "Everyone in this room sees what you draw · Esc or click outside to close"}
        </div>
      </div>
    </div>
  );
}
