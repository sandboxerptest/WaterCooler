"use client";

import { useEffect, useRef } from "react";
import type * as PhaserTypes from "phaser";
import { createLogger } from "@/lib/logger";

const log = createLogger("PhaserGame");

export default function PhaserGame() {
  const gameRef = useRef<PhaserTypes.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    let observer: ResizeObserver | null = null;

    async function initGame() {
      if (!containerRef.current) return;

      const { gameConfig } = await import("./config");
      const Phaser = await import("phaser");

      if (!mounted) return;

      const game = new Phaser.Game({
        ...gameConfig,
        parent: containerRef.current,
      });
      gameRef.current = game;

      // Phaser only checks its parent's size twice a second, which is a
      // visible lag while the chat column is being dragged. Watching the
      // container puts the canvas on the same frame as the drag.
      let lastWidth = 0;
      let lastHeight = 0;
      observer = new ResizeObserver(([entry]) => {
        const width = Math.round(entry.contentRect.width);
        const height = Math.round(entry.contentRect.height);
        // A drag fires this on every frame with sub-pixel differences, and
        // each call rebuilds the WebGL framebuffer. Only act on real changes.
        if (width <= 0 || height <= 0) return;
        if (width === lastWidth && height === lastHeight) return;
        lastWidth = width;
        lastHeight = height;
        // In RESIZE mode the scale manager derives the game size from what it
        // believes the parent to be, and it only re-reads that on a window
        // resize or its own twice-a-second poll. Collapsing the chat column is
        // neither: the element simply unmounts, the stage reflows, and no
        // window event fires — so telling it the parent size directly, and
        // refreshing, is what actually moves the canvas.
        game.scale.setParentSize(width, height);
        game.scale.refresh();
        log.debug(`canvas -> ${width}x${height}`);
      });
      observer.observe(containerRef.current);
    }

    initGame().catch((err) => {
      log.error("init failed:", err);
    });

    return () => {
      mounted = false;
      observer?.disconnect();
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        imageRendering: "pixelated",
      }}
    />
  );
}
