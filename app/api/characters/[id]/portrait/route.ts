import { NextResponse } from "next/server";
import { isCharacterId, readPortrait } from "@/lib/characters/store";
import { decodePng, encodePng } from "@/lib/pixel/png";
import { sliceFrame, PORTRAIT_COLUMN, PORTRAIT_ROW } from "@/lib/pixel/compose";

/**
 * A character's face, as a 48x96 PNG.
 *
 * Exists so a gallery of characters costs a few kilobytes per card rather
 * than a full sheet each — the sheet is 21 megapixels once decoded, and a
 * browser showing five of them as CSS backgrounds decodes all five.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isCharacterId(id)) {
    return NextResponse.json({ error: "Unknown character" }, { status: 400 });
  }

  const portrait = readPortrait(id, (sheet) =>
    encodePng(sliceFrame(decodePng(sheet), PORTRAIT_COLUMN, PORTRAIT_ROW)),
  );
  if (!portrait) return NextResponse.json({ error: "Unknown character" }, { status: 404 });

  return new NextResponse(new Uint8Array(portrait), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
