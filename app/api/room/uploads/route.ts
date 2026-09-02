import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, formatBytes } from "@/lib/attachments";
import { saveUpload } from "@/lib/server/uploads";
import { normaliseRoomSlug } from "@/lib/rooms";

export const dynamic = "force-dynamic";

/**
 * Files to hand to an agent with a task: ?room=<slug>, multipart with one
 * or more "files". Answers with a reference per file, to send along with
 * the task.
 */
export async function POST(request: Request) {
  const room = normaliseRoomSlug(new URL(request.url).searchParams.get("room"));
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a file upload" }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0)
    return Response.json({ error: "Choose a file to attach" }, { status: 400 });
  if (files.length > MAX_ATTACHMENTS) {
    return Response.json({ error: `At most ${MAX_ATTACHMENTS} files at a time` }, { status: 400 });
  }
  const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_BYTES);
  if (tooBig) {
    return Response.json(
      { error: `${tooBig.name} is over ${formatBytes(MAX_ATTACHMENT_BYTES)}` },
      { status: 413 },
    );
  }
  const attachments = [];
  for (const file of files) {
    const stored = saveUpload(room, file.name, new Uint8Array(await file.arrayBuffer()));
    attachments.push({ id: stored.id, name: stored.name, size: stored.size });
  }
  return Response.json({ attachments });
}
