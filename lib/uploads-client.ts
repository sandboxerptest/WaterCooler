/**
 * Sending files to the room, from the browser's side.
 *
 * Files are uploaded when chosen, so by the time the task is sent all that
 * goes with it is a list of references.
 */

import type { AttachmentRef } from "./attachments";
import { currentRoom } from "./room-client";

export async function uploadFiles(files: File[]): Promise<AttachmentRef[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  const res = await fetch(`/api/room/uploads?room=${encodeURIComponent(currentRoom())}`, {
    method: "POST",
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as {
    attachments?: AttachmentRef[];
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return body.attachments ?? [];
}
