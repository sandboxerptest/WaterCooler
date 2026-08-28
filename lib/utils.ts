import type { AgentProvider } from "@/types/game";
import { roomFromLocation } from "./rooms";

/**
 * Returns the configured agent provider.
 * Set via NEXT_PUBLIC_AGENT_PROVIDER env var (available client-side).
 */
export function getAgentProvider(): AgentProvider {
  const val = process.env.NEXT_PUBLIC_AGENT_PROVIDER;
  if (val === "auggie") return "auggie";
  if (val === "openclaw") return "openclaw";
  if (val === "claude-api") return "claude-api";
  if (val === "mettara") return "mettara";
  return "claude";
}

/**
 * True when agents run through the in-process bridge rather than an OpenClaw
 * gateway. These providers need no URL or token, so the app auto-connects to
 * its own bridge — whether that bridge spawns a CLI or calls a hosted API.
 */
export function isCliProvider(provider: AgentProvider = getAgentProvider()): boolean {
  return (
    provider === "auggie" ||
    provider === "claude" ||
    provider === "claude-api" ||
    provider === "mettara"
  );
}

/** Human-readable provider name for HUD copy. */
export function getProviderLabel(provider: AgentProvider = getAgentProvider()): string {
  if (provider === "auggie") return "Auggie";
  if (provider === "claude") return "Claude Code";
  if (provider === "claude-api") return "Claude (API key)";
  if (provider === "mettara") return "Mettara AI";
  return "OpenClaw";
}

/**
 * What a person has to do for this provider to work, shown in the connection
 * panel before the first successful run. Hosted providers need credentials on
 * the server, not a CLI on the machine.
 */
export function getProviderSetupHint(provider: AgentProvider = getAgentProvider()): string {
  if (provider === "mettara") {
    return "Mettara runs on the server: set METTARA_API_SECRET and METTARA_PLATFORM_ID, and install the Mettara SDK.";
  }
  if (provider === "claude-api") {
    return "Make sure ANTHROPIC_API_KEY is set on the server.";
  }
  return "Make sure the CLI is installed and signed in.";
}

export function getDefaultGatewayUrl() {
  if (process.env.NEXT_PUBLIC_GATEWAY_URL) {
    return process.env.NEXT_PUBLIC_GATEWAY_URL;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // The bridge needs to know which room a run belongs to: the roster it can
    // delegate to, the sandbox it writes in and the budget it spends are all
    // per room.
    const room = encodeURIComponent(roomFromLocation(window.location));
    return `${protocol}//${window.location.host}/api/gateway?room=${room}`;
  }

  return "ws://localhost:3000/api/gateway";
}

/**
 * Parse a user-friendly gateway address into a full WebSocket URL.
 *
 *   "192.168.1.100:18789"  → "ws://192.168.1.100:18789/"
 *   "ws://host:port/path"  → kept as-is
 *   "wss://host:port"      → kept as-is
 *   ""                     → fallback to getDefaultGatewayUrl()
 */
/**
 * Returns null if the input is not a valid WebSocket URL.
 */
export function parseGatewayAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return getDefaultGatewayUrl();
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+(:\d+)?(\/.*)?$/.test(trimmed)) {
    return `ws://${trimmed}${trimmed.endsWith("/") ? "" : "/"}`;
  }
  return null;
}
