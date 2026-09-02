"use client";

import { useCallback, useEffect, useState } from "react";
import type { RosterCharacter } from "./library";

/**
 * The full character list, fetched once per mount.
 *
 * Both pickers — the seat manager for agents, the studio for the person —
 * read from here, so a character uploaded in one is immediately offered in
 * the other. `refresh` is for the studio to call after it makes one.
 */
export function useCharacterRoster() {
  const [characters, setCharacters] = useState<RosterCharacter[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/characters");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { characters?: RosterCharacter[] };
      setCharacters(body.characters ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { characters, error, refresh };
}
