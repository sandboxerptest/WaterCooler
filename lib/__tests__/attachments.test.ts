import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENTS,
  attachmentNote,
  attachmentRefs,
  formatBytes,
  safeFileName,
} from "../attachments";

describe("a file name", () => {
  it("keeps only the name, without paths, control characters or a leading dot", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\x\\report.pdf")).toBe("report.pdf");
    expect(safeFileName(".hidden")).toBe("hidden");
    expect(safeFileName("bad\u0000name.txt")).toBe("badname.txt");
    expect(safeFileName("   ")).toBe("file");
    expect(safeFileName("a".repeat(200)).length).toBe(120);
  });
});

describe("attachment references", () => {
  it("keep the well-formed ones, and no more than the limit", () => {
    const good = { id: "0123456789abcdef0123456789abcdef", name: "a.txt", size: 3 };
    expect(attachmentRefs([good, { id: "nope", name: "b", size: 1 }, "x", null])).toEqual([good]);
    const many = Array.from({ length: MAX_ATTACHMENTS + 3 }, (_, i) => ({
      ...good,
      name: `${i}.txt`,
    }));
    expect(attachmentRefs(many)).toHaveLength(MAX_ATTACHMENTS);
    expect(attachmentRefs("not a list")).toEqual([]);
  });
});

describe("the note to the agent", () => {
  it("lists where the files are, and says nothing when there are none", () => {
    expect(attachmentNote([])).toBe("");
    expect(attachmentNote(["attachments/a.pdf", "attachments/b.csv"])).toContain(
      "- attachments/a.pdf\n- attachments/b.csv",
    );
  });

  it("sizes files for people", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(20 * 1024)).toBe("20 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
