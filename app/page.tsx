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
import { SIDEBAR_DEFAULT_WIDTH } from "@/lib/constants";

const PhaserGame = dynamic(() => import("@/components/game/PhaserGame"), {
  ssr: false,
});

/** The stored width is a client-only fact, so the server must not read it. */
const subscribeToNothing = () => () => {};

export default function Page() {
  const storedWidth = useSyncExternalStore(
    subscribeToNothing,
    loadSidebarWidth,
    () => SIDEBAR_DEFAULT_WIDTH,
  );
  const [width, setWidth] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);

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
            onClose={() => setSidebarOpen(false)}
          />

          <TerminalModal />
          <WorkerSessionHistoryModal />
        </main>
      </StudioProvider>
    </ErrorBoundary>
  );
}
