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

/**
 * What a single room may spend on agents before it stops dispatching. This is a
 * hard stop rather than a warning: with an open room and a host-side API key,
 * the bill is the host's, and a runaway loop should end by itself.
 */
export const ROOM_SPEND_LIMIT_USD = Number(process.env.ROOM_SPEND_LIMIT_USD ?? 50);

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
  active_session_key TEXT,
  spend_usd          REAL NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS achievements (
  room         TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  code         TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  earned_at    TEXT NOT NULL,
  PRIMARY KEY (room, subject_type, subject_id, code)
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
    this.migrate();
    log.info(`opened ${path}`);
  }

  /** Additive migrations for databases created by an earlier version. */
  private migrate() {
    for (const statement of [
      "ALTER TABLE rooms ADD COLUMN spend_usd REAL NOT NULL DEFAULT 0",
      "ALTER TABLE tasks ADD COLUMN requested_by_name TEXT",
    ]) {
      try {
        this.db.exec(statement);
      } catch {
        // Already present, which is the common case
      }
    }
  }

  // ── Achievements ──────────────────────────────────────

  /**
   * Record an achievement. Returns true only the first time, so callers can
   * treat a true result as "announce this" without tracking state themselves.
   */
  award(
    room: string,
    subjectType: string,
    subjectId: string,
    code: string,
    subjectName: string,
  ): boolean {
    this.ensureRoom(room);
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO achievements
           (room, subject_type, subject_id, code, subject_name, earned_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(room, subjectType, subjectId, code, subjectName, new Date().toISOString());
    return result.changes > 0;
  }

  listAchievements(room: string) {
    this.ensureRoom(room);
    return this.db
      .prepare(
        `SELECT subject_type AS subjectType, subject_id AS subjectId, code,
                subject_name AS subjectName, earned_at AS earnedAt
         FROM achievements WHERE room = ? ORDER BY earned_at`,
      )
      .all(room) as Array<{
      subjectType: string;
      subjectId: string;
      code: string;
      subjectName: string;
      earnedAt: string;
    }>;
  }

  /** How many tasks a seat has finished, for "first time" style rules. */
  countCompletedTasksForSeat(room: string, seatId: string): number {
    this.ensureRoom(room);
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE room = ? AND seat_id = ? AND status = ?")
      .get(room, seatId, "completed") as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /** Seats a given person has given work to, and how many seats are staffed. */
  assignmentBreadth(room: string, requesterName: string): { assigned: number; staffed: number } {
    this.ensureRoom(room);
    const assigned = this.db
      .prepare(
        `SELECT COUNT(DISTINCT seat_id) AS n FROM tasks
         WHERE room = ? AND requested_by_name = ? AND seat_id IS NOT NULL`,
      )
      .get(room, requesterName) as { n: number } | undefined;

    const seats = parseRows(
      this.db.prepare("SELECT data FROM seats WHERE room = ?").all(room) as DataRow[],
    ) as Array<{ assigned?: boolean }>;

    return {
      assigned: assigned?.n ?? 0,
      staffed: seats.filter((seat) => seat.assigned).length,
    };
  }

  /**
   * Record what a run cost. Spend is tracked server-side because it is what a
   * ceiling has to be enforced against — a client could simply not report it.
   */
  addSpend(room: string, usd: number) {
    if (!Number.isFinite(usd) || usd <= 0) return;
    this.ensureRoom(room);
    this.db.prepare("UPDATE rooms SET spend_usd = spend_usd + ? WHERE slug = ?").run(usd, room);
  }

  /** True once this room has spent its allowance. */
  isOverBudget(room: string): boolean {
    return this.getSpend(room) >= ROOM_SPEND_LIMIT_USD;
  }

  getSpend(room: string): number {
    this.ensureRoom(room);
    const row = this.db.prepare("SELECT spend_usd FROM rooms WHERE slug = ?").get(room) as
      | { spend_usd: number }
      | undefined;
    return row?.spend_usd ?? 0;
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

  // ── Per-entity writes ─────────────────────────────────
  // A shared room cannot use whole-slice writes: two people acting at once
  // would each send a list that omits the other's work, and the later write
  // would erase it. These apply one change at a time.

  upsertTask(room: string, task: Record<string, unknown>) {
    this.ensureRoom(room);
    const id = asString(task.taskId) ?? asString(task.runId);
    if (!id) return;

    const existing = this.db
      .prepare("SELECT position FROM tasks WHERE room = ? AND task_id = ?")
      .get(room, id) as { position: number } | undefined;

    // New tasks go to the head, matching the newest-first list the client keeps
    const position = existing?.position ?? this.nextHeadPosition(room, "tasks");

    this.db
      .prepare(
        `INSERT INTO tasks (room, task_id, seat_id, session_key, status, requested_by, created_at, position, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (room, task_id) DO UPDATE SET
           seat_id = excluded.seat_id,
           session_key = excluded.session_key,
           status = excluded.status,
           requested_by = COALESCE(excluded.requested_by, tasks.requested_by),
           data = excluded.data`,
      )
      .run(
        room,
        id,
        asString(task.seatId),
        asString(task.sessionKey),
        asString(task.status),
        asString(task.requestedBy),
        asString(task.createdAt) ?? new Date().toISOString(),
        position,
        JSON.stringify(task),
      );

    // Kept in a column so "gave work to every seat" is a query rather than a scan
    const requesterName = asString(task.requestedByName);
    if (requesterName) {
      this.db
        .prepare("UPDATE tasks SET requested_by_name = ? WHERE room = ? AND task_id = ?")
        .run(requesterName, room, id);
    }

    this.trim(room, "tasks", LIMITS.tasks, "DESC");
  }

  appendMessage(room: string, message: Record<string, unknown>) {
    this.ensureRoom(room);
    const id = asString(message.id);
    if (!id) return;

    const existing = this.db
      .prepare("SELECT position FROM messages WHERE room = ? AND message_id = ?")
      .get(room, id) as { position: number } | undefined;

    const position = existing?.position ?? this.nextTailPosition(room, "messages");

    this.db
      .prepare(
        `INSERT INTO messages (room, message_id, session_key, author_type, author, created_at, position, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (room, message_id) DO UPDATE SET
           session_key = excluded.session_key,
           author_type = excluded.author_type,
           author = excluded.author,
           data = excluded.data`,
      )
      .run(
        room,
        id,
        asString(message.sessionKey),
        asString(message.role) ?? "system",
        asString(message.actorName) ?? asString(message.author),
        asString(message.timestamp) ?? new Date().toISOString(),
        position,
        JSON.stringify(message),
      );

    this.trim(room, "messages", LIMITS.messages, "ASC");
  }

  upsertSeat(room: string, seat: Record<string, unknown>) {
    this.ensureRoom(room);
    const id = asString(seat.seatId);
    if (!id) return;

    this.db
      .prepare(
        `INSERT INTO seats (room, seat_id, updated_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT (room, seat_id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data`,
      )
      .run(room, id, new Date().toISOString(), JSON.stringify(seat));
  }

  upsertSession(room: string, session: Record<string, unknown>) {
    this.ensureRoom(room);
    const key = asString(session.sessionKey) ?? asString(session.key);
    if (!key) return;

    const existing = this.db
      .prepare("SELECT position FROM sessions WHERE room = ? AND session_key = ?")
      .get(room, key) as { position: number } | undefined;

    this.db
      .prepare(
        `INSERT INTO sessions (room, session_key, updated_at, position, data) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (room, session_key) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data`,
      )
      .run(
        room,
        key,
        new Date().toISOString(),
        existing?.position ?? this.nextHeadPosition(room, "sessions"),
        JSON.stringify(session),
      );

    this.trim(room, "sessions", LIMITS.sessions, "DESC");
  }

  /** Newest-first collections grow downward from the current minimum. */
  private nextHeadPosition(room: string, table: "tasks" | "sessions"): number {
    const row = this.db
      .prepare(`SELECT MIN(position) AS edge FROM ${table} WHERE room = ?`)
      .get(room) as { edge: number | null };
    return (row?.edge ?? 0) - 1;
  }

  /** Oldest-first collections grow upward from the current maximum. */
  private nextTailPosition(room: string, table: "messages"): number {
    const row = this.db
      .prepare(`SELECT MAX(position) AS edge FROM ${table} WHERE room = ?`)
      .get(room) as { edge: number | null };
    return (row?.edge ?? 0) + 1;
  }

  /**
   * Keep a collection within its cap, dropping from the end that matters least:
   * the oldest chat, and the oldest tasks and sessions.
   */
  private trim(
    room: string,
    table: "tasks" | "messages" | "sessions",
    limit: number,
    keep: "ASC" | "DESC",
  ) {
    const idColumn =
      table === "tasks" ? "task_id" : table === "messages" ? "message_id" : "session_key";
    this.db
      .prepare(
        `DELETE FROM ${table} WHERE room = ? AND ${idColumn} IN (
           SELECT ${idColumn} FROM ${table} WHERE room = ?
           ORDER BY position ${keep === "ASC" ? "DESC" : "ASC"}
           LIMIT -1 OFFSET ?
         )`,
      )
      .run(room, room, limit);
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
