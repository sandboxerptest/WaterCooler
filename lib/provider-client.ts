/**
 * Which AI runs the agents, from the browser's side.
 *
 * The connection panel asks the server what is running and what else could,
 * and can switch it. Nothing here depends on the build-time provider: the
 * server answers for itself.
 */

import type { CliProviderId } from "./cli-providers";

export interface ProviderChoice {
  id: CliProviderId;
  label: string;
  /** Why it cannot run right now, or null when it is ready. */
  blocked: string | null;
  hint: string;
}

export interface ProviderState {
  active: CliProviderId;
  default: CliProviderId;
  choices: ProviderChoice[];
}

/** Null when there is no bridge to ask — an OpenClaw gateway, say. */
export async function fetchProviders(): Promise<ProviderState | null> {
  try {
    const res = await fetch("/api/provider");
    return res.ok ? ((await res.json()) as ProviderState) : null;
  } catch {
    return null;
  }
}

/** Switch, and hear back the new state — or why the switch was refused. */
export async function chooseProvider(
  id: CliProviderId,
): Promise<{ state: ProviderState | null; refused: string | null }> {
  try {
    const res = await fetch("/api/provider", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = (await res.json()) as ProviderState & { error?: string };
    if (!res.ok) return { state: body.choices ? body : null, refused: body.error ?? "Refused." };
    return { state: body, refused: null };
  } catch {
    return { state: null, refused: "The server could not be reached." };
  }
}
