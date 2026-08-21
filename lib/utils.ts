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
  return "claude";
}

/**
 * True when agents run through a local CLI rather than an OpenClaw gateway.
 * CLI providers need no URL or token, so the app auto-connects to its own
 * in-process bridge.
 */
export function isCliProvider(provider: AgentProvider = getAgentProvider()): boolean {
  return provider === "auggie" || provider === "claude" || provider === "claude-api";
}

/** Human-readable provider name for HUD copy. */
export function getProviderLabel(provider: AgentProvider = getAgentProvider()): string {
  if (provider === "auggie") return "Auggie";
  if (provider === "claude") return "Claude Code";
  if (provider === "claude-api") return "Claude (API key)";
  return "OpenClaw";
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
