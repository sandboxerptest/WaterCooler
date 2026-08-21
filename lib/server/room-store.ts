/**
 * Room store — the server-side source of truth for a world.
 *
 * Backed by SQLite through node's built-in driver, so there is no native
 * dependency and no service to run locally. All SQL lives in this module: the
 * move to Postgres in the hosting phase should be a swap here, not a change at
 * every call site.
 *
 * Rows keep real columns for the things the server will need to reason about
 * later (room, seat, status, who asked, when) and a JSON `data` column for the
 * full client object. That gets the world onto the server without freezing the
 * client's model while it is still moving.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { createLogger } from "../logger";

const log = createLogger("RoomStore");

/** Single-player still means one room; multiplayer gives it a real slug. */
export const DEFAULT_ROOM = process.env.ROOM_SLUG ?? "local";

/** Placeholder until players have identities of their own. */
export const LOCAL_PLAYER = "local";

const DB_PATH = process.env.ROOM_DB_PATH ?? join(process.cwd(), ".data", "watercooler.sqlite");

/** Mirrors the client-side caps so the server cannot grow without bound. */
export const LIMITS = {
  tasks: 200,
  messages: 400,
  sessions: 40,
} as const;

export interface RoomSnapshot {
  tasks: unknown[];
  messages: unknown[];
  sessions: unknown[];
  seats: unknown[];
  activeSessionKey: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  slug               TEXT PRIMARY KEY,
  created_at         TEXT NOT NULL,
  active_session_key TEXT
);

CREATE TABLE IF NOT EXISTS players (
  id           TEXT NOT NULL,
  room         TEXT NOT NULL,
  display_name TEXT NOT NULL,
  sprite_key   TEXT,
  last_seen    TEXT NOT NULL,
  PRIMARY KEY (room, id)
);

CREATE TABLE IF NOT EXISTS seats (
  room       TEXT NOT NULL,
  seat_id    TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (room, seat_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  room         TEXT NOT NULL,
  task_id      TEXT NOT NULL,
  seat_id      TEXT,
  session_key  TEXT,
  status       TEXT,
  requested_by TEXT,
  created_at   TEXT NOT NULL,
  position     INTEGER NOT NULL,
  data         TEXT NOT NULL,
  PRIMARY KEY (room, task_id)
);

CREATE TABLE IF NOT EXISTS messages (
  room        TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  session_key TEXT,
  author_type TEXT NOT NULL,
  author      TEXT,
  created_at  TEXT NOT NULL,
  position    INTEGER NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (room, message_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  room        TEXT NOT NULL,
  session_key TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  position    INTEGER NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (room, session_key)
);

CREATE INDEX IF NOT EXISTS tasks_by_room ON tasks (room, position);
CREATE INDEX IF NOT EXISTS messages_by_room ON messages (room, position);
CREATE INDEX IF NOT EXISTS sessions_by_room ON sessions (room, position);
`;

interface DataRow {
  data: string;
}

function parseRows(rows: DataRow[]): unknown[] {
  const out: unknown[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.data));
    } catch {
      // A single corrupt row should not take the whole room down
      log.warn("skipping unparseable row");
    }
  }
  return out;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export class RoomStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
    log.info(`opened ${path}`);
  }

  ensureRoom(room: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO rooms (slug, created_at) VALUES (?, ?)")
      .run(room, new Date().toISOString());
  }

  getSnapshot(room: string): RoomSnapshot {
    this.ensureRoom(room);

    const roomRow = this.db
      .prepare("SELECT active_session_key FROM rooms WHERE slug = ?")
      .get(room) as { active_session_key: string | null } | undefined;

    return {
      tasks: parseRows(
        this.db
          .prepare("SELECT data FROM tasks WHERE room = ? ORDER BY position")
          .all(room) as DataRow[],
      ),
      messages: parseRows(
        this.db
          .prepare("SELECT data FROM messages WHERE room = ? ORDER BY position")
          .all(room) as DataRow[],
      ),
      sessions: parseRows(
        this.db
          .prepare("SELECT data FROM sessions WHERE room = ? ORDER BY position")
          .all(room) as DataRow[],
      ),
      seats: parseRows(
        this.db
          .prepare("SELECT data FROM seats WHERE room = ? ORDER BY seat_id")
          .all(room) as DataRow[],
      ),
      activeSessionKey: roomRow?.active_session_key ?? null,
    };
  }

  setActiveSessionKey(room: string, key: string | null) {
    this.ensureRoom(room);
    this.db.prepare("UPDATE rooms SET active_session_key = ? WHERE slug = ?").run(key, room);
  }

  /**
   * The client owns ordering and trimming of these collections today, so a
   * write replaces the room's whole slice inside one transaction. Per-entity
   * events arrive with the shared-world phase.
   */
  replaceTasks(room: string, tasks: Record<string, unknown>[]) {
    this.ensureRoom(room);
    const capped = tasks.slice(0, LIMITS.tasks);
    this.transaction(() => {
      this.db.prepare("DELETE FROM tasks WHERE room = ?").run(room);
      const insert = this.db.prepare(
        `INSERT INTO tasks (room, task_id, seat_id, session_key, status, requested_by, created_at, position, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      capped.forEach((task, index) => {
        const id = asString(task.taskId) ?? asString(task.runId);
        if (!id) return;
        insert.run(
          room,
          id,
          asString(task.seatId),
          asString(task.sessionKey),
          asString(task.status),
          asString(task.requestedBy) ?? LOCAL_PLAYER,
          asString(task.createdAt) ?? new Date().toISOString(),
          index,
          JSON.stringify(task),
        );
      });
    });
  }

  replaceMessages(room: string, messages: Record<string, unknown>[]) {
    this.ensureRoom(room);
    const capped = messages.slice(-LIMITS.messages);
    this.transaction(() => {
      this.db.prepare("DELETE FROM messages WHERE room = ?").run(room);
      const insert = this.db.prepare(
        `INSERT INTO messages (room, message_id, session_key, author_type, author, created_at, position, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      capped.forEach((message, index) => {
        const id = asString(message.id);
        if (!id) return;
        // "role" today is assistant/user/system; players become a fourth author type
        insert.run(
          room,
          id,
          asString(message.sessionKey),
          asString(message.role) ?? "system",
          asString(message.actorName),
          asString(message.timestamp) ?? new Date().toISOString(),
          index,
          JSON.stringify(message),
        );
      });
    });
  }

  replaceSessions(room: string, sessions: Record<string, unknown>[]) {
    this.ensureRoom(room);
    const capped = sessions.slice(0, LIMITS.sessions);
    this.transaction(() => {
      this.db.prepare("DELETE FROM sessions WHERE room = ?").run(room);
      const insert = this.db.prepare(
        "INSERT INTO sessions (room, session_key, updated_at, position, data) VALUES (?, ?, ?, ?, ?)",
      );
      capped.forEach((session, index) => {
        const key = asString(session.sessionKey) ?? asString(session.key);
        if (!key) return;
        insert.run(room, key, new Date().toISOString(), index, JSON.stringify(session));
      });
    });
  }

  replaceSeats(room: string, seats: Record<string, unknown>[]) {
    this.ensureRoom(room);
    this.transaction(() => {
      this.db.prepare("DELETE FROM seats WHERE room = ?").run(room);
      const insert = this.db.prepare(
        "INSERT INTO seats (room, seat_id, updated_at, data) VALUES (?, ?, ?, ?)",
      );
      const now = new Date().toISOString();
      for (const seat of seats) {
        const id = asString(seat.seatId);
        if (!id) continue;
        insert.run(room, id, now, JSON.stringify(seat));
      }
    });
  }

  private transaction(fn: () => void) {
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

/**
 * Next.js reloads modules in dev, so the handle hangs off globalThis to avoid
 * opening a second connection to the same file on every hot reload.
 */
const globalForStore = globalThis as unknown as { __roomStore?: RoomStore };

export function getRoomStore(): RoomStore {
  if (!globalForStore.__roomStore) {
    globalForStore.__roomStore = new RoomStore(DB_PATH);
  }
  return globalForStore.__roomStore;
}
