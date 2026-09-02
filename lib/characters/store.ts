/**
 * Where generated characters live.
 *
 * Under .data/ rather than public/, for the same reason the databases are:
 * public/ is baked into the container image at build time, so anything written
 * there is lost on the next deploy. .data/ is the directory that survives.
 * The sheets are served back by a route handler instead of the static server.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { createLogger } from "../logger";
import type { CharacterColours } from "../pixel/character";
import { librarySheetPath } from "./library";

const log = createLogger("Characters");

export const CHARACTER_DIR =
  process.env.CHARACTER_DIR ?? join(process.cwd(), ".data", "characters");

const MANIFEST = "index.json";

export interface StoredCharacter extends Partial<CharacterColours> {
  id: string;
  name: string;
  notes: string;
  createdAt: string;
  /**
   * "photo": built by re-skinning the library sheet with colours read from a
   * picture. "sheet": an entire drawn sheet that was cut up and re-laid onto
   * the game's grid. The four colours exist only for the first kind.
   */
  source: "photo" | "sheet";
  /**
   * For sheets: "exact" was stored as uploaded, already in the game's format;
   * "loose" was found, read and re-laid onto the grid; "library" was a whole
   * library-style sheet of which only the two animated rows were used.
   */
  layout?: "exact" | "loose" | "library";
}

/** Ids go in URLs and in filenames, so they are deliberately dull. */
export function isCharacterId(value: string): boolean {
  return /^[a-z0-9_-]{4,64}$/.test(value);
}

/**
 * A display name from an uploaded filename.
 *
 * Drops the extension, the separators, and any "48x48"-style size token —
 * a sheet named for its format is not named for its character. Trimmed
 * *after* the length cut, so a cut cannot leave a trailing space behind.
 */
export function nameFromFile(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\.[^.]+$/, "")
    .split(/[_\-\s]+/)
    .filter((part) => part && !/^\d+x\d+$/i.test(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .slice(0, 24)
    .trim();
}

export function makeCharacterId(name: string, now: number): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "character";
  return `${slug}-${now.toString(36)}`;
}

function ensureDir() {
  mkdirSync(CHARACTER_DIR, { recursive: true });
}

export function sheetPath(id: string): string {
  return join(CHARACTER_DIR, `${id}.png`);
}

export function portraitPath(id: string): string {
  return join(CHARACTER_DIR, `${id}.portrait.png`);
}

/**
 * The 48x96 face frame, cut from the sheet on first request and kept.
 *
 * Made lazily rather than at save time so sheets written before portraits
 * existed get one too, and so a failed cut never stops a character saving.
 */
export function readPortrait(id: string, cut: (sheet: Buffer) => Buffer): Buffer | null {
  if (!isCharacterId(id)) return null;
  try {
    return readFileSync(portraitPath(id));
  } catch {
    // fall through to cutting one
  }
  const sheet = readSheet(id);
  if (!sheet) return null;
  const portrait = cut(sheet);
  try {
    writeFileSync(portraitPath(id), portrait);
  } catch (err) {
    log.warn(`could not keep portrait for ${id}: ${(err as Error).message}`);
  }
  return portrait;
}

export function listCharacters(): StoredCharacter[] {
  try {
    const raw = readFileSync(join(CHARACTER_DIR, MANIFEST), "utf8");
    const parsed = JSON.parse(raw) as StoredCharacter[];
    if (!Array.isArray(parsed)) return [];
    // Characters written before sheets existed have no source; they were all
    // built from photos, and the HUD shows colour swatches only for those.
    return parsed.map((c) => ({ ...c, source: c.source ?? "photo" }));
  } catch {
    // No manifest yet is the normal state on a fresh install.
    return [];
  }
}

export function readSheet(id: string): Buffer | null {
  if (!isCharacterId(id)) return null;
  // A library id resolves to the shipped file; everything else to .data/.
  const shipped = librarySheetPath(id);
  const path = shipped ? join(process.cwd(), "public", shipped) : sheetPath(id);
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/**
 * Writes the sheet and records it.
 *
 * The manifest is written to a temporary file and renamed, so a crash midway
 * leaves the previous list intact rather than a half-written one that would
 * take every existing character down with it.
 */
export function saveCharacter(character: StoredCharacter, sheet: Buffer): StoredCharacter {
  ensureDir();
  writeFileSync(sheetPath(character.id), sheet);

  const next = [character, ...listCharacters().filter((c) => c.id !== character.id)];
  const tmp = join(CHARACTER_DIR, `${MANIFEST}.tmp`);
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, join(CHARACTER_DIR, MANIFEST));

  log.info(`saved character ${character.id} ("${character.name}")`);
  return character;
}

/**
 * Changes a character's name.
 *
 * Names come from the model or from a filename, and neither is the person's
 * choice. This is. Returns the updated character, or null if there is none.
 */
export function renameCharacter(id: string, name: string): StoredCharacter | null {
  const clean = name.trim().slice(0, 24);
  if (!isCharacterId(id) || !clean) return null;
  const all = listCharacters();
  const target = all.find((c) => c.id === id);
  if (!target) return null;
  const updated = { ...target, name: clean };
  const next = all.map((c) => (c.id === id ? updated : c));
  const tmp = join(CHARACTER_DIR, `${MANIFEST}.tmp`);
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, join(CHARACTER_DIR, MANIFEST));
  log.info(`renamed ${id} to "${clean}"`);
  return updated;
}

/**
 * Removes a character: its sheet, its portrait, and its line in the manifest.
 *
 * Library characters are not stored here and cannot be removed this way —
 * they are files in the repository, and taking one away is a code change.
 * The manifest is rewritten first, so a crash between the two steps leaves
 * an orphaned file (which orphanedSheets reports) rather than a listed
 * character with no sheet behind it.
 */
export function deleteCharacter(id: string): boolean {
  if (!isCharacterId(id)) return false;
  const all = listCharacters();
  if (!all.some((c) => c.id === id)) return false;

  const next = all.filter((c) => c.id !== id);
  const tmp = join(CHARACTER_DIR, `${MANIFEST}.tmp`);
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, join(CHARACTER_DIR, MANIFEST));

  for (const file of [sheetPath(id), portraitPath(id)]) {
    try {
      unlinkSync(file);
    } catch {
      // Already gone, or never made (a portrait is cut lazily).
    }
  }
  log.info(`removed character ${id}`);
  return true;
}

/** A filename that carries a name, as opposed to a camera's serial number. */
export function isMeaningfulName(name: string): boolean {
  return /[a-z]{2,}/i.test(name);
}

/** Rebuilds the manifest from the sheets on disk, for a manifest gone missing. */
export function orphanedSheets(): string[] {
  try {
    const known = new Set(listCharacters().map((c) => c.id));
    return readdirSync(CHARACTER_DIR)
      .filter((f) => f.endsWith(".png"))
      .map((f) => f.replace(/\.png$/, ""))
      .filter((id) => !known.has(id));
  } catch {
    return [];
  }
}
