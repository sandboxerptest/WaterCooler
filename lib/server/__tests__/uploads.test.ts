import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveUpload, saveUpload } from "../uploads";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wc-uploads-"));
  process.env.UPLOADS_DIR = dir;
});

afterEach(() => {
  delete process.env.UPLOADS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("an upload", () => {
  it("is kept under the room, by id, under a cleaned name, and found again", () => {
    const saved = saveUpload("Castle Atlantic", "../notes.txt", new TextEncoder().encode("hi"));
    expect(saved.name).toBe("notes.txt");
    expect(saved.size).toBe(2);
    expect(saved.path.startsWith(join(dir, "castle-atlantic", saved.id))).toBe(true);
    expect(readFileSync(saved.path, "utf8")).toBe("hi");

    const found = resolveUpload("castle-atlantic", saved.id);
    expect(found).toEqual(saved);
  });

  it("is not found from another room, nor by a made-up id", () => {
    const saved = saveUpload("castle-atlantic", "a.txt", new Uint8Array([1]));
    expect(resolveUpload("sandbox-erp", saved.id)).toBeNull();
    expect(resolveUpload("castle-atlantic", "../../etc")).toBeNull();
    expect(resolveUpload("castle-atlantic", "0123456789abcdef")).toBeNull();
  });
});
