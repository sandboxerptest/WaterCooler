"use client";

import { gameEvents } from "@/lib/events";
import "./hud.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudio } from "@/lib/store";
import { useBgm } from "@/lib/useBgm";
import { loadOnboardingDone, loadGatewayConfig, saveOnboardingDone } from "@/lib/persistence";
import type { HudDockItem, HudPanelId } from "./HudDock";
import TopBar from "./TopBar";
import BottomBar from "./BottomBar";
import ConnectionPanel from "./ConnectionPanel";
import WorkerPanel from "./WorkerPanel";
import SeatManagerModal from "./SeatManagerModal";
import MusicControls from "./MusicControls";
import OnboardingOverlay from "./OnboardingOverlay";
import NamePrompt from "./NamePrompt";
import AchievementToast from "./AchievementToast";
import Whiteboard from "./Whiteboard";
import Pinball from "./Pinball";
import PingPong from "./PingPong";
import TouchControls from "./TouchControls";

interface GameHudProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export default function GameHud({ sidebarOpen, onToggleSidebar }: GameHudProps) {
  const { state } = useStudio();
  const bgm = useBgm();
  const [openPanel, setOpenPanel] = useState<HudPanelId | null>(null);
  const [seatManagerOpen, setSeatManagerOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(
    () => !loadOnboardingDone() && !loadGatewayConfig(),
  );

  // Auto-dismiss onboarding when connection panel opens
  useEffect(() => {
    if (showOnboarding && openPanel === "connection") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to panel open
      setShowOnboarding(false);
      saveOnboardingDone();
    }
  }, [showOnboarding, openPanel]);

  // Auto-open connection panel on auth/connection failures
  useEffect(() => {
    if (
      state.connection === "auth_failed" ||
      state.connection === "unreachable" ||
      state.connection === "rate_limited"
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to connection state
      setOpenPanel("connection");
    } else if (state.connection === "connected") {
      setOpenPanel((prev) => (prev === "connection" ? null : prev));
    }
  }, [state.connection]);

  // Gamepad shoulder buttons cycle the HUD panels; Back closes whatever is open
  useEffect(() => {
    const order: HudPanelId[] = ["chat", "music", "connection", "tasks", "workers"];

    const unsubCycle = gameEvents.on("hud-cycle-panel", (direction) => {
      setSeatManagerOpen(false);
      setOpenPanel((prev) => {
        const current = prev ? order.indexOf(prev) : -1;
        const next = (current + direction + order.length) % order.length;
        const id = order[next];
        if (id === "workers") {
          setSeatManagerOpen(true);
          return null;
        }
        return id;
      });
    });

    const unsubClose = gameEvents.on("hud-close-panel", () => {
      setOpenPanel(null);
      setSeatManagerOpen(false);
    });

    return () => {
      unsubCycle();
      unsubClose();
    };
  }, []);

  // Top-right toolbar items (everything except chat)
  const toolItems: HudDockItem[] = useMemo(
    () => [
      {
        id: "music",
        label: "Music",
        icon: "/ui/icons/icon-music.png",
        iconActive: "/ui/icons/icon-music-active.png",
      },
      {
        id: "connection",
        label: "Connection",
        icon: "/ui/icons/icon-connection.png",
        iconActive: "/ui/icons/icon-connection-active.png",
      },
      {
        id: "workers",
        label: "Employees",
        icon: "/ui/icons/icon-workers.png",
        iconActive: "/ui/icons/icon-workers-active.png",
      },
    ],
    [],
  );

  const togglePanel = useCallback((id: HudPanelId) => {
    if (id === "workers") {
      setSeatManagerOpen((prev) => !prev);
      return;
    }
    setOpenPanel((current) => (current === id ? null : id));
  }, []);

  const musicIconOverrides = useMemo(
    () => (bgm.volume <= 0 ? { music: "/ui/icons/icon-music-muted.png" as string } : undefined),
    [bgm.volume],
  );

  const topRightPanelOpen = openPanel && openPanel !== "chat";

  return (
    <div className="hud-overlay">
      <NamePrompt />
      <AchievementToast />
      <Whiteboard />
      <Pinball />
      <PingPong />
      <TouchControls />
      {/* Top area: logo | agent pills | tool buttons */}
      <TopBar
        seats={state.seats}
        toolItems={toolItems}
        openPanel={openPanel}
        onToggle={togglePanel}
        iconOverrides={musicIconOverrides}
      />

      {/* Top-right flyout panels */}
      {topRightPanelOpen && (
        <div className="hud-topright-flyout">
          {openPanel === "music" ? <MusicControls bgm={bgm} /> : null}
          {openPanel === "connection" ? <ConnectionPanel /> : null}
          {openPanel === "workers" ? (
            <WorkerPanel seats={state.seats} onOpenManager={() => setSeatManagerOpen(true)} />
          ) : null}
        </div>
      )}

      {/* Bottom area: status pills (left) + chat dock (right) */}
      <div className="layout-bottom">
        <BottomBar
          connection={state.connection}
          sessionMetrics={state.sessionMetrics}
          seats={state.seats}
        />

        {/* Spacer pushes chat to right */}
        <div style={{ flex: "1 1 auto" }} />

        {/* Chat lives in the column beside the office; this shows it again */}
        <div className="hud-chat-dock">
          <button
            type="button"
            className={`hud-chat-dock__btn ${sidebarOpen ? "hud-chat-dock__btn--active" : ""}`}
            onClick={onToggleSidebar}
            title={sidebarOpen ? "Hide chat" : "Show chat"}
          >
            <img
              src={sidebarOpen ? "/ui/icons/icon-chat-active.png" : "/ui/icons/icon-chat.png"}
              alt="Chat"
              width={28}
              height={28}
              style={{ imageRendering: "pixelated" }}
            />
            <span className="hud-chat-dock__label">Chat</span>
          </button>
        </div>
      </div>

      {/* Modals */}
      <SeatManagerModal
        open={seatManagerOpen}
        onClose={() => setSeatManagerOpen(false)}
        seats={state.seats}
      />

      {showOnboarding && <OnboardingOverlay onDone={() => setShowOnboarding(false)} />}
    </div>
  );
}
