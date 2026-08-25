"use client";

import dynamic from "next/dynamic";
import { useCallback, useState, useSyncExternalStore } from "react";
import { StudioProvider } from "@/lib/store";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GameErrorBoundary } from "@/components/game/GameErrorBoundary";
import TerminalModal from "@/components/panel/TerminalModal";
import WorkerSessionHistoryModal from "@/components/panel/WorkerSessionHistoryModal";
import GameHud from "@/components/hud/GameHud";
import Sidebar from "@/components/hud/Sidebar";
import { loadSidebarWidth } from "@/lib/persistence";
import { useBackToClose } from "@/lib/hooks/useBackToClose";
import { SIDEBAR_DEFAULT_WIDTH } from "@/lib/constants";

const PhaserGame = dynamic(() => import("@/components/game/PhaserGame"), {
  ssr: false,
});

/** The stored width is a client-only fact, so the server must not read it. */
const subscribeToNothing = () => () => {};

/**
 * Below this the column is a drawer over the office rather than a column
 * beside it — and a drawer has no business being open before it is asked for.
 */
const SIDEBAR_FITS_AT = 900;
const readWideEnough = () => window.innerWidth >= SIDEBAR_FITS_AT;

export default function Page() {
  const storedWidth = useSyncExternalStore(
    subscribeToNothing,
    loadSidebarWidth,
    () => SIDEBAR_DEFAULT_WIDTH,
  );
  const [width, setWidth] = useState<number | null>(null);
  /** Null until the reader says otherwise; the screen decides to begin with. */
  const [sidebarChoice, setSidebarChoice] = useState<boolean | null>(null);
  const wideEnough = useSyncExternalStore(subscribeToNothing, readWideEnough, () => true);
  const sidebarOpen = sidebarChoice ?? wideEnough;

  const toggleSidebar = useCallback(() => setSidebarChoice(!sidebarOpen), [sidebarOpen]);
  const closeSidebar = useCallback(() => setSidebarChoice(false), []);

  // Only while it is a drawer over the office. Where it is a column beside
  // the office it covers nothing, and back should still mean back.
  useBackToClose(sidebarOpen && !wideEnough, closeSidebar);

  return (
    <ErrorBoundary>
      <StudioProvider>
        {/* The office on the left, the record of what happened on the right */}
        <main className="app-shell">
          <div className="app-stage">
            <GameErrorBoundary>
              <PhaserGame />
            </GameErrorBoundary>

            {/* HUD overlay — floating UI over the office only */}
            <div className="app-hud">
              <GameHud sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
            </div>
          </div>

          <Sidebar
            open={sidebarOpen}
            width={width ?? storedWidth}
            onWidthChange={setWidth}
            onClose={closeSidebar}
          />

          <TerminalModal />
          <WorkerSessionHistoryModal />
        </main>
      </StudioProvider>
    </ErrorBoundary>
  );
}
