import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { decodePng, encodePng } from "@/lib/pixel/png";
import {
  detectPoses,
  diagnoseSheet,
  pickLibraryRows,
  positionalAssignments,
} from "@/lib/pixel/ingest";
import {
  composeSheet,
  reconcileRows,
  sanitiseAssignments,
  FACINGS,
  FRAME_H,
  FRAME_W,
} from "@/lib/pixel/compose";
import { readSheet } from "@/lib/characters/poses";
import { emptySlots, isExactSheet, normaliseExactSheet } from "@/lib/pixel/exact";
import {
  isMeaningfulName,
  makeCharacterId,
  nameFromFile,
  saveCharacter,
  type StoredCharacter,
} from "@/lib/characters/store";

const log = createLogger("Characters");

/** A drawn sheet is bigger than a photo; image models return 1-4MB PNGs. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MIN_FIGURES = 1;
const MAX_FIGURES = 64;

/**
 * Turns a whole drawn character sheet into a playable character.
 *
 * This is the path for art that was *imagined* rather than recoloured — an
 * image model's output, or a sheet drawn by hand. The geometry is found here
 * (figures, rows, cut-outs), the model is asked only what it is good at
 * (which way each figure faces, whether it is walking), and the result is
 * laid onto the grid the game hard-codes, so the character animates exactly
 * like the ones shipped with it.
 *
 * Only PNG is accepted, on purpose. The browser converts whatever was chosen
 * to PNG before uploading, which means any format the browser can open works
 * without this server needing a decoder for each of them.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const file = form.get("sheet");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a sprite sheet to upload" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That sheet is over 12MB" }, { status: 413 });
  }

  let image;
  try {
    image = decodePng(Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read that image: ${(err as Error).message}` },
      { status: 415 },
    );
  }

  // A sheet already in the game's format is used as it is. No model, no
  // re-layout, no API key needed — only the two tidy-ups that are always
  // safe, and an honest list of anything missing.
  if (isExactSheet(image)) {
    const { sheet, backdropRemoved, padded } = normaliseExactSheet(image);
    const missing = emptySlots(sheet);
    const name = nameFromFile(form.get("name")) || "New hire";
    const character: StoredCharacter = {
      id: makeCharacterId(name, Date.now()),
      name,
      notes: missing.length
        ? `Uploaded sheet; ${missing.length} of 48 animated frames are empty.`
        : "Uploaded sheet in the game's format.",
      createdAt: new Date().toISOString(),
      source: "sheet",
      layout: "exact",
    };
    saveCharacter(character, encodePng(sheet));
    return NextResponse.json({
      character,
      mode: "exact",
      backdropRemoved,
      padded,
      emptySlots: missing,
    });
  }

  const detected = detectPoses(image);
  const keyed = detected.keyed;
  // A model's copy of a whole library sheet has hundreds of figures; the two
  // rows the game animates are all that is needed, and they fit the cap.
  const libraryRows = detected.poses.length > MAX_FIGURES ? pickLibraryRows(detected.poses) : null;
  const poses = libraryRows ?? detected.poses;
  const diagnosis = diagnoseSheet(image, keyed, poses, MAX_FIGURES);
  if (poses.length < MIN_FIGURES || poses.length > MAX_FIGURES || diagnosis.reason) {
    log.warn(
      `sheet rejected: ${diagnosis.reason} [${diagnosis.width}x${diagnosis.height}, backdrop ${diagnosis.backdrop}, ${diagnosis.figures} figures, ~${diagnosis.figureHeight}px tall]`,
    );
    return NextResponse.json(
      { error: `${diagnosis.reason} ${diagnosis.advice}`.trim(), diagnosis },
      { status: 422 },
    );
  }

  try {
    // The model sees the sheet with its backdrop removed, which is closer to
    // what the figures actually are than the original's noise-filled black.
    // With a model available it reads the facings; without one, a
    // library-shaped sheet can still be laid out from where each figure sits.
    const canRead = Boolean(process.env.ANTHROPIC_API_KEY);
    const reading =
      canRead || !libraryRows
        ? await readSheet(encodePng(keyed), poses, keyed.width, keyed.height)
        : {
            name: nameFromFile(form.get("name")) || "New hire",
            notes: "Laid out from a library-style sheet by position.",
            assignments: sanitiseAssignments(positionalAssignments(poses, FACINGS), poses.length),
          };
    const { assignments, corrected } = reconcileRows(reading.assignments, (i) => poses[i].row);
    if (corrected.length) {
      log.info(`row vote corrected the facing of figure(s) ${corrected.join(", ")}`);
    }
    const frames = poses.map((p) => p.toFrame(FRAME_W, FRAME_H));
    const sheet = composeSheet(frames, assignments);

    // "yash.png" is a name; "1000060232.png" is a camera counter. Use the
    // person's own word for it when they gave one, the model's otherwise.
    const fromFile = nameFromFile(form.get("name"));
    const name = isMeaningfulName(fromFile) ? fromFile : reading.name;

    const character: StoredCharacter = {
      id: makeCharacterId(name, Date.now()),
      name,
      notes: reading.notes,
      createdAt: new Date().toISOString(),
      source: "sheet",
      layout: libraryRows ? "library" : "loose",
    };
    saveCharacter(character, encodePng(sheet));

    return NextResponse.json({
      character,
      mode: libraryRows ? "library" : "loose",
      figures: poses.length,
      figuresOnSheet: detected.poses.length,
      assigned: assignments.length,
      corrected: corrected.length,
    });
  } catch (err) {
    const message = (err as Error).message ?? "Could not build that character";
    log.error("ingest failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
