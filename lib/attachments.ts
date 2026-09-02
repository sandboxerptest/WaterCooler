/**
 * Files handed to an agent along with a task.
 *
 * Shared by the browser, the API and the bridge, so nothing here touches
 * the filesystem: the rules about names and sizes, and the note that tells
 * an agent where its files are.
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;

/** What the browser keeps after an upload, and sends with the task. */
export interface AttachmentRef {
  id: string;
  name: string;
  size: number;
}

const ID = /^[a-f0-9]{16,32}$/;

/**
 * A file name safe to write anywhere: no paths, no control characters,
 * nothing hidden, and never empty.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || "file";
}

export function isAttachmentRef(value: unknown): value is AttachmentRef {
  if (typeof value !== "object" || value === null) return false;
  const { id, name, size } = value as Record<string, unknown>;
  return (
    typeof id === "string" && ID.test(id) && typeof name === "string" && typeof size === "number"
  );
}

/** Only the well-formed ones, and no more than the limit. */
export function attachmentRefs(value: unknown): AttachmentRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isAttachmentRef).slice(0, MAX_ATTACHMENTS);
}

/** Appended to the task, so the agent knows what came with it and where it is. */
export function attachmentNote(paths: string[]): string {
  if (paths.length === 0) return "";
  return `\n\nAttached files, saved in your workspace:\n${paths.map((p) => `- ${p}`).join("\n")}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
