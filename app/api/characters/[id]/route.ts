import { NextResponse } from "next/server";
import { deleteCharacter, isCharacterId, readSheet, renameCharacter } from "@/lib/characters/store";

/**
 * Serves a generated sprite sheet.
 *
 * These live under .data/ rather than public/, so they need a handler — the
 * static server never sees them. Cached hard: a sheet never changes once
 * written, because a regenerated character gets a new id.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isCharacterId(id)) {
    return NextResponse.json({ error: "Unknown character" }, { status: 400 });
  }

  const sheet = readSheet(id);
  if (!sheet) return NextResponse.json({ error: "Unknown character" }, { status: 404 });

  return new NextResponse(new Uint8Array(sheet), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

/** Rename. The only thing about a stored character a person may change. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Give the character a name" }, { status: 400 });
  }
  const updated = renameCharacter(id, body.name);
  if (!updated) return NextResponse.json({ error: "Unknown character" }, { status: 404 });
  return NextResponse.json({ character: updated });
}

/** Remove an uploaded or generated character. Library characters are not deletable. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isCharacterId(id)) {
    return NextResponse.json({ error: "Unknown character" }, { status: 400 });
  }
  if (id.startsWith("library-")) {
    return NextResponse.json(
      { error: "Characters that ship with the game cannot be removed" },
      { status: 403 },
    );
  }
  return deleteCharacter(id)
    ? NextResponse.json({ removed: id })
    : NextResponse.json({ error: "Unknown character" }, { status: 404 });
}
