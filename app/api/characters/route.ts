import { NextResponse } from "next/server";
import { listCharacters } from "@/lib/characters/store";
import { LIBRARY_CHARACTERS, type RosterCharacter } from "@/lib/characters/library";

/** Every character available to pick: the library, then everything made here. */
export function roster(): RosterCharacter[] {
  const made: RosterCharacter[] = listCharacters().map((c) => ({
    id: c.id,
    key: `generated:${c.id}`,
    name: c.name,
    sheetUrl: `/api/characters/${c.id}`,
    portraitUrl: `/api/characters/${c.id}/portrait`,
    source: c.source,
    layout: c.layout,
    notes: c.notes,
  }));
  return [...LIBRARY_CHARACTERS, ...made];
}

export async function GET() {
  return NextResponse.json({ characters: roster() });
}
