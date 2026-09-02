"use client";

import { useEffect, useState } from "react";
import { useStudio } from "@/lib/store";
import { chooseProvider, fetchProviders, type ProviderState } from "@/lib/provider-client";
import type { CliProviderId } from "@/lib/cli-providers";
import { LS_CONFIG, STATUS_LABELS } from "@/lib/constants";
import {
  parseGatewayAddress,
  isCliProvider,
  getProviderLabel,
  getProviderSetupHint,
} from "@/lib/utils";
import HudFlyout from "./HudFlyout";

const DEFAULT_GATEWAY = "ws://127.0.0.1:18789";
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";
const IS_CLI = isCliProvider();
const PROVIDER_LABEL = getProviderLabel();
const SETUP_HINT = getProviderSetupHint();

function loadSavedConfig(): { url: string; token: string } {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(LS_CONFIG) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { url?: string; token?: string };
      return {
        url: parsed.url || DEFAULT_GATEWAY,
        token: parsed.token || DEFAULT_TOKEN,
      };
    }
  } catch {}
  return { url: DEFAULT_GATEWAY, token: DEFAULT_TOKEN };
}

export default function ConnectionPanel() {
  const { state, connect, disconnect } = useStudio();
  const [url, setUrl] = useState(() => loadSavedConfig().url);
  const [token, setToken] = useState(() => loadSavedConfig().token);
  const isConnected = state.connection === "connected";
  const isConnecting = state.connection === "connecting";
  const isAuthFailed = state.connection === "auth_failed";
  const isUnreachable = state.connection === "unreachable";
  const isRateLimited = state.connection === "rate_limited";

  const [error, setError] = useState("");

  // Which AI the agents run on, and what else they could: the server says.
  const [providers, setProviders] = useState<ProviderState | null>(null);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    if (!IS_CLI) return;
    let live = true;
    void fetchProviders().then((state) => {
      if (live) setProviders(state);
    });
    return () => {
      live = false;
    };
  }, []);
  const activeLabel =
    providers?.choices.find((c) => c.id === providers.active)?.label ?? PROVIDER_LABEL;

  /** Switch the agents to another AI, then connect to it. Only while disconnected. */
  const handleChoose = async (id: CliProviderId) => {
    if (!providers || isConnected || isConnecting) return;
    setError("");
    if (id !== providers.active) {
      setSwitching(true);
      const { state, refused } = await chooseProvider(id);
      if (state) setProviders(state);
      setSwitching(false);
      if (refused) {
        setError(refused);
        return;
      }
    }
    connect({ url: parseGatewayAddress("") ?? "", token: "" });
  };

  const handleConnect = () => {
    setError("");
    if (IS_CLI) {
      // CLI providers need no gateway URL or token — connect via the local bridge
      connect({ url: parseGatewayAddress("") ?? "", token: "" });
      return;
    }
    const parsed = parseGatewayAddress(url);
    if (!parsed) {
      setError("Invalid URL. Use ws://host:port or host:port.");
      return;
    }
    connect({ url: parsed, token: token.trim() });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      handleConnect();
    }
  };

  return (
    <HudFlyout
      title="Connection"
      subtitle={`${STATUS_LABELS[state.connection]}${IS_CLI ? ` (${activeLabel})` : " gateway link"}`}
    >
      <div className="hud-panel__stack">
        {IS_CLI && providers && providers.choices.length > 1 && (
          <>
            <label className="hud-panel__label">Agents run on</label>
            <div className="hud-panel__choices" role="radiogroup" aria-label="Agent provider">
              {providers.choices.map((choice) => {
                const active = choice.id === providers.active;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`pixel-button hud-choice${active ? " hud-choice--active" : ""}`}
                    onClick={() => void handleChoose(choice.id)}
                    disabled={isConnected || isConnecting || switching}
                    title={
                      choice.blocked ??
                      (choice.id === providers.default ? "The default" : choice.hint)
                    }
                  >
                    {choice.label}
                    {active ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
            {(isConnected || isConnecting) && (
              <p style={{ color: "var(--pixel-muted)", fontSize: "8px" }}>
                Disconnect to switch the agents to another AI.
              </p>
            )}
          </>
        )}
        {!IS_CLI && (
          <>
            <label className="hud-panel__label">Gateway URL</label>
            <input
              className="pixel-input hud-panel__input"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              placeholder="ws://127.0.0.1:18789"
              disabled={isConnected || isConnecting}
            />
            <label className="hud-panel__label">Token</label>
            <input
              className="pixel-input hud-panel__input"
              type="password"
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              placeholder="optional"
              disabled={isConnected || isConnecting}
            />
          </>
        )}
        {IS_CLI && !isConnected && !isConnecting && (
          <p style={{ color: "var(--pixel-muted)", fontSize: "8px" }}>
            Using {activeLabel} as agent provider.{" "}
            {providers?.choices.find((c) => c.id === providers.active)?.hint ?? SETUP_HINT}
          </p>
        )}
        {isAuthFailed && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            Authentication failed. Token may be invalid or expired — please re-enter.
          </p>
        )}
        {isUnreachable && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            Gateway is unreachable. Please check if your gateway is running.
          </p>
        )}
        {isRateLimited && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            Too many failed attempts. Please wait a moment before retrying.
          </p>
        )}
        {error && <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>{error}</p>}
        {!isConnected && !isConnecting ? (
          <button
            type="button"
            className="pixel-button pixel-button--primary"
            onClick={handleConnect}
            disabled={!url.trim()}
          >
            Connect
          </button>
        ) : null}
        {isConnected ? (
          <button type="button" className="pixel-button" onClick={disconnect}>
            Disconnect
          </button>
        ) : null}
        {isConnecting ? (
          <button type="button" className="pixel-button" onClick={disconnect}>
            Cancel
          </button>
        ) : null}
      </div>
    </HudFlyout>
  );
}
