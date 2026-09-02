import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { LIBRARY_CHARACTERS, LIBRARY_PREFIX, librarySheetPath, textureKeyFor } from "../library";

describe("the library roster", () => {
  it("lists every shipped worker and the boss", () => {
    expect(LIBRARY_CHARACTERS.length).toBeGreaterThanOrEqual(5);
    expect(LIBRARY_CHARACTERS.some((c) => c.key === "character_09")).toBe(true);
    for (const c of LIBRARY_CHARACTERS) {
      expect(c.id.startsWith(LIBRARY_PREFIX)).toBe(true);
      expect(c.source).toBe("library");
      expect(c.sheetUrl).toMatch(/^\/characters\/.+\.png$/);
      expect(c.portraitUrl).toBe(`/api/characters/${c.id}/portrait`);
    }
  });

  it("keeps the texture key a library sheet is preloaded under", () => {
    // Workers are created against these keys at boot; renaming one would
    // leave an existing seat pointing at a texture that no longer exists.
    const alice = LIBRARY_CHARACTERS.find((c) => c.name === "Alice")!;
    expect(textureKeyFor(alice)).toBe("character_02");
  });

  it("namespaces uploaded characters so they cannot collide with the library", () => {
    expect(textureKeyFor({ id: "kai-abc", key: "x", source: "sheet" })).toBe("generated:kai-abc");
  });

  it("resolves a library id to its shipped file and nothing else", () => {
    expect(librarySheetPath("library-character_02")).toBe(
      "/characters/Premade_Character_48x48_02.png",
    );
    expect(librarySheetPath("kai-abc")).toBeNull();
  });
});

describe("the merged roster", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wc-roster-"));
    process.env.CHARACTER_DIR = dir;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CHARACTER_DIR;
  });

  it("puts the library first and every upload after it, in one shape", async () => {
    writeFileSync(
      join(dir, "index.json"),
      JSON.stringify([
        { id: "kai-abc", name: "Kai", notes: "", createdAt: "a", source: "sheet", layout: "loose" },
      ]),
    );
    const { roster } = await import("../../../app/api/characters/route");
    const all = roster();
    expect(all.slice(0, LIBRARY_CHARACTERS.length)).toEqual(LIBRARY_CHARACTERS);
    const kai = all[all.length - 1];
    expect(kai).toMatchObject({
      id: "kai-abc",
      key: "generated:kai-abc",
      sheetUrl: "/api/characters/kai-abc",
      portraitUrl: "/api/characters/kai-abc/portrait",
      source: "sheet",
      layout: "loose",
    });
  });

  it("serves a library sheet through the same read as an upload", async () => {
    const store = await import("../store");
    const sheet = store.readSheet("library-character_09");
    expect(sheet).not.toBeNull();
    expect(sheet!.length).toBeGreaterThan(10_000);
    expect(store.readSheet("library-nope")).toBeNull();
  });
});
