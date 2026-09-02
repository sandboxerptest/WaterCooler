import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { describeCharacter, isAcceptedType, ACCEPTED_TYPES } from "@/lib/characters/analyse";
import { makeCharacterId, saveCharacter, type StoredCharacter } from "@/lib/characters/store";
import { BASE_SHEET, renderCharacterSheet } from "@/lib/pixel/character";

const log = createLogger("Characters");

/** Vision requests are billed by image size, and a sprite needs no more. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Turns an uploaded picture into a playable character.
 *
 * Two steps, deliberately separate: Claude looks at the image and names four
 * colours, then those colours are painted onto a library sprite sheet. The
 * model never draws anything — it cannot — so the sheet that comes out has the
 * same geometry, frame grid and animation timing as every character already in
 * the game.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a picture to upload" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `That picture is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 5MB` },
      { status: 413 },
    );
  }
  if (!isAcceptedType(file.type)) {
    return NextResponse.json(
      { error: `Use a ${ACCEPTED_TYPES.map((t) => t.replace("image/", "")).join(", ")} image` },
      { status: 415 },
    );
  }

  const hint = form.get("hint");
  const image = Buffer.from(await file.arrayBuffer());

  try {
    const described = await describeCharacter({
      image,
      mediaType: file.type,
      hint: typeof hint === "string" ? hint : undefined,
    });

    const base = readFileSync(join(process.cwd(), "public", "characters", BASE_SHEET));
    const sheet = renderCharacterSheet(base, described);

    const character: StoredCharacter = {
      id: makeCharacterId(described.name, Date.now()),
      name: described.name,
      notes: described.notes,
      hair: described.hair,
      skin: described.skin,
      outfit: described.outfit,
      shoes: described.shoes,
      createdAt: new Date().toISOString(),
      source: "photo",
    };

    saveCharacter(character, sheet);
    return NextResponse.json({ character });
  } catch (err) {
    const message = (err as Error).message ?? "Could not build that character";
    log.error("generate failed:", message);
    // The messages here are written to be read by a person in a dialog, so
    // they are passed through rather than replaced with a generic failure.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
