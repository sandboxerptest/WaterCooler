import type { ChatMessage } from "@/types/game";

/**
 * Who a chat bubble is from, in words.
 *
 * Three voices share the log: you, another person in the room, and an
 * agent. A person's task message is signed with their presence id and
 * name; one without a signature is from before signing existed, and was
 * only ever this browser's own.
 */
export function speakerLabel(
  msg: Pick<ChatMessage, "role" | "actorName" | "authorId">,
  self: { id: string | null; name: string },
  fallbackActor?: string,
): string {
  if (msg.role === "player") return `${msg.actorName ?? "Someone"} · here`;
  if (msg.role === "user") {
    const mine =
      !msg.authorId ||
      msg.authorId === self.id ||
      (msg.actorName !== undefined && msg.actorName === self.name);
    return mine ? "You" : (msg.actorName ?? "Someone");
  }
  return msg.actorName ?? fallbackActor ?? "Assistant";
}
