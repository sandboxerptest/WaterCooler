import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { coerceDescription, describeCharacter, setMessagesClient } from "../analyse";
import { BASE_COLOURS } from "../../pixel/character";

describe("reading the model's answer", () => {
  it("keeps colours it can use", () => {
    const out = coerceDescription({
      name: "Priya",
      hair: "#1A1A1A",
      skin: "#C98A5E",
      outfit: "#2E7D4F",
      shoes: "#5B3A29",
      notes: "Green jacket, dark hair.",
    });
    expect(out).toEqual({
      name: "Priya",
      hair: "#1a1a1a",
      skin: "#c98a5e",
      outfit: "#2e7d4f",
      shoes: "#5b3a29",
      notes: "Green jacket, dark hair.",
    });
  });

  it("falls back to the base sheet rather than failing on a bad colour", () => {
    // Losing a whole character over one malformed hex would be the wrong
    // trade; the base colour is always valid and the person can change it.
    const out = coerceDescription({ name: "Sam", hair: "greenish", outfit: "#fff" });
    expect(out.hair).toBe(BASE_COLOURS.hair);
    expect(out.outfit).toBe(BASE_COLOURS.outfit);
    expect(out.skin).toBe(BASE_COLOURS.skin);
  });

  it("survives a completely empty answer", () => {
    const out = coerceDescription(null);
    expect(out.name).toBe("New hire");
    expect(out.hair).toBe(BASE_COLOURS.hair);
  });

  it("trims a runaway name or note", () => {
    const out = coerceDescription({ name: "x".repeat(200), notes: "y".repeat(500) });
    expect(out.name.length).toBeLessThanOrEqual(24);
    expect(out.notes.length).toBeLessThanOrEqual(140);
  });
});

describe("describeCharacter", () => {
  afterEach(() => setMessagesClient(null));

  type SentRequest = {
    model: string;
    messages: Array<{ content: Array<{ type: string; text?: string }> }>;
  };

  const stub = (text: string, stopReason = "end_turn") => ({
    create: vi.fn(async (request: SentRequest) => {
      void request;
      return { stop_reason: stopReason, content: [{ type: "text", text }] };
    }),
  });

  it("sends the picture and returns the colours", async () => {
    const client = stub(
      JSON.stringify({
        name: "Ada",
        hair: "#c2571f",
        skin: "#f6d3b0",
        outfit: "#2e7d4f",
        shoes: "#5b3a29",
        notes: "Ginger hair, green coat.",
      }),
    );
    setMessagesClient(client as never);

    const out = await describeCharacter({
      image: Buffer.from("not really a png"),
      mediaType: "image/png",
      hint: "make them cheerful",
    });

    expect(out.name).toBe("Ada");
    expect(out.hair).toBe("#c2571f");

    const sent = client.create.mock.calls[0][0];
    expect(sent.model).toBe("claude-opus-5");
    expect(sent.messages[0].content[0].type).toBe("image");
    expect(sent.messages[0].content[1].text).toContain("make them cheerful");
  });

  it("reports a refusal as something a person can act on", async () => {
    setMessagesClient(stub("", "refusal") as never);
    await expect(
      describeCharacter({ image: Buffer.from("x"), mediaType: "image/png" }),
    ).rejects.toThrow(/different one/i);
  });

  it("reports unreadable output rather than crashing", async () => {
    setMessagesClient(stub("this is not json") as never);
    await expect(
      describeCharacter({ image: Buffer.from("x"), mediaType: "image/png" }),
    ).rejects.toThrow(/could not be read/i);
  });
});

describe("nameFromFile", () => {
  it("turns a library filename into a name, dropping the size token", async () => {
    const { nameFromFile } = await import("../store");
    expect(nameFromFile("Premade_Character_48x48_06.png")).toBe("Premade Character 06");
    expect(nameFromFile("yoshi-data-scientist.PNG")).toBe("Yoshi Data Scientist");
  });

  it("never ends on a space after the length cut", async () => {
    const { nameFromFile } = await import("../store");
    const name = nameFromFile("a_very_long_character_name_that_keeps_going.png");
    expect(name.length).toBeLessThanOrEqual(24);
    expect(name).toBe(name.trim());
  });

  it("is empty for anything that is not a filename", async () => {
    const { nameFromFile } = await import("../store");
    expect(nameFromFile(null)).toBe("");
    expect(nameFromFile(42)).toBe("");
  });
});

describe("meaningful names", () => {
  it("tells a name from a camera counter", async () => {
    const { isMeaningfulName, nameFromFile } = await import("../store");
    expect(isMeaningfulName(nameFromFile("Yash.png"))).toBe(true);
    expect(isMeaningfulName(nameFromFile("1000060232.png"))).toBe(false);
    expect(isMeaningfulName(nameFromFile("IMG_4021.jpg"))).toBe(true); // "IMG" is a word, but a poor one
  });
});

describe("the character store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wc-characters-"));
    process.env.CHARACTER_DIR = dir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CHARACTER_DIR;
  });

  it("saves a character and reads it back", async () => {
    const store = await import("../store");
    const sheet = Buffer.from("pretend png");
    const character = {
      id: "ada-abc123",
      name: "Ada",
      notes: "",
      hair: "#c2571f",
      skin: "#f6d3b0",
      outfit: "#2e7d4f",
      shoes: "#5b3a29",
      createdAt: new Date(0).toISOString(),
      source: "photo" as const,
    };

    store.saveCharacter(character, sheet);
    expect(store.listCharacters()).toEqual([character]);
    expect(store.readSheet("ada-abc123")?.toString()).toBe("pretend png");
  });

  it("puts the newest character first and replaces a repeat id", async () => {
    const store = await import("../store");
    const base = {
      notes: "",
      hair: "#111111",
      skin: "#222222",
      outfit: "#333333",
      shoes: "#444444",
      source: "photo" as const,
    };
    store.saveCharacter({ ...base, id: "one", name: "One", createdAt: "a" }, Buffer.from("1"));
    store.saveCharacter({ ...base, id: "two", name: "Two", createdAt: "b" }, Buffer.from("2"));
    store.saveCharacter(
      { ...base, id: "one", name: "One again", createdAt: "c" },
      Buffer.from("3"),
    );

    const ids = store.listCharacters().map((c) => c.id);
    expect(ids).toEqual(["one", "two"]);
    expect(store.listCharacters()[0].name).toBe("One again");
  });

  it("returns nothing for an id that is not one of ours", async () => {
    const store = await import("../store");
    // Ids reach the filesystem, so anything path-shaped must not resolve.
    expect(store.readSheet("../../etc/passwd")).toBeNull();
    expect(store.readSheet("nope")).toBeNull();
    expect(store.isCharacterId("../secret")).toBe(false);
    expect(store.isCharacterId("ada-abc123")).toBe(true);
  });

  it("makes an id that is safe in a URL and a filename", async () => {
    const store = await import("../store");
    const id = store.makeCharacterId("Ada  Lovelace!! ", 0);
    expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(store.isCharacterId(id)).toBe(true);
    expect(store.makeCharacterId("!!!", 0)).toMatch(/^character-/);
  });

  it("treats a character saved before sources existed as a photo", async () => {
    const store = await import("../store");
    writeFileSync(
      join(dir, "index.json"),
      JSON.stringify([{ id: "old-one", name: "Old", notes: "", createdAt: "a", hair: "#111111" }]),
    );
    expect(store.listCharacters()[0].source).toBe("photo");
  });

  it("survives a manifest that has been corrupted", async () => {
    const store = await import("../store");
    writeFileSync(join(dir, "index.json"), "{ broken");
    expect(store.listCharacters()).toEqual([]);
  });

  it("renames a character and nothing else about it", async () => {
    const store = await import("../store");
    const base = { notes: "", createdAt: "a", source: "sheet" as const, layout: "loose" as const };
    store.saveCharacter({ ...base, id: "deshawn-1", name: "Deshawn" }, Buffer.from("1"));
    const updated = store.renameCharacter("deshawn-1", "  Yash  ");
    expect(updated?.name).toBe("Yash");
    expect(store.listCharacters()[0]).toMatchObject({
      id: "deshawn-1",
      name: "Yash",
      layout: "loose",
    });
    expect(store.readSheet("deshawn-1")?.toString()).toBe("1");
  });

  it("refuses to rename to nothing, or to rename nothing", async () => {
    const store = await import("../store");
    store.saveCharacter(
      { id: "one", name: "One", notes: "", createdAt: "a", source: "photo" },
      Buffer.from("1"),
    );
    expect(store.renameCharacter("one", "   ")).toBeNull();
    expect(store.renameCharacter("nope", "X")).toBeNull();
    expect(store.listCharacters()[0].name).toBe("One");
  });

  it("removes a character, its sheet and its portrait", async () => {
    const store = await import("../store");
    const base = { notes: "", createdAt: "a", source: "sheet" as const };
    store.saveCharacter({ ...base, id: "gone-1", name: "Gone" }, Buffer.from("1"));
    store.saveCharacter({ ...base, id: "stays-1", name: "Stays" }, Buffer.from("2"));
    writeFileSync(join(dir, "gone-1.portrait.png"), "p");
    expect(store.deleteCharacter("gone-1")).toBe(true);
    expect(store.listCharacters().map((c) => c.id)).toEqual(["stays-1"]);
    expect(store.readSheet("gone-1")).toBeNull();
    expect(store.readSheet("stays-1")?.toString()).toBe("2");
    expect(store.orphanedSheets()).toEqual([]);
  });

  it("reports false for a character that is not there", async () => {
    const store = await import("../store");
    expect(store.deleteCharacter("nope")).toBe(false);
    expect(store.deleteCharacter("../etc")).toBe(false);
  });

  it("notices sheets the manifest has lost track of", async () => {
    const store = await import("../store");
    store.saveCharacter(
      {
        id: "kept",
        name: "K",
        notes: "",
        hair: "#111111",
        skin: "#222222",
        outfit: "#333333",
        shoes: "#444444",
        createdAt: "a",
        source: "photo",
      },
      Buffer.from("1"),
    );
    writeFileSync(join(dir, "stray-abc.png"), "orphan");
    expect(store.orphanedSheets()).toEqual(["stray-abc"]);
  });
});
