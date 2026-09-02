/**
 * Where uploaded files live on the server.
 *
 * Each upload gets its own folder named by a random id, holding the file
 * under its own (cleaned) name, so nothing a person types can reach outside
 * the room's folder. On the volume beside the room database, so a deploy
 * does not lose them.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normaliseRoomSlug } from "../rooms";
import { safeFileName, type AttachmentRef } from "../attachments";

function uploadsRoot(): string {
  if (process.env.UPLOADS_DIR) return process.env.UPLOADS_DIR;
  const db = process.env.ROOM_DB_PATH;
  return db ? join(dirname(db), "uploads") : join(process.cwd(), ".data", "uploads");
}

export interface StoredUpload extends AttachmentRef {
  path: string;
}

export function saveUpload(room: string, name: string, bytes: Uint8Array): StoredUpload {
  const id = randomBytes(12).toString("hex");
  const safe = safeFileName(name);
  const dir = join(uploadsRoot(), normaliseRoomSlug(room), id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, safe);
  writeFileSync(path, bytes);
  return { id, name: safe, size: bytes.byteLength, path };
}

/** The file behind an upload id in a room, or null when there is none. */
export function resolveUpload(room: string, id: string): StoredUpload | null {
  if (!/^[a-f0-9]{16,32}$/.test(id)) return null;
  const dir = join(uploadsRoot(), normaliseRoomSlug(room), id);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const name = entries[0];
  if (!name) return null;
  const path = join(dir, name);
  try {
    return { id, name, size: statSync(path).size, path };
  } catch {
    return null;
  }
}
