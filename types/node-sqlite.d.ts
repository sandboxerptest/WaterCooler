/**
 * Minimal typings for node's built-in SQLite driver.
 *
 * @types/node is pinned at v20 here, which predates `node:sqlite`. Rather than
 * bump the whole project's node types for one module, this declares just the
 * surface lib/server/room-store.ts uses. Delete it once @types/node ships them.
 */
declare module "node:sqlite" {
  export type SQLValue = string | number | bigint | Uint8Array | null;

  export interface StatementSync {
    run(...params: SQLValue[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: SQLValue[]): unknown;
    all(...params: SQLValue[]): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
